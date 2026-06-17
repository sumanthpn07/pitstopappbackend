import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, Prisma, Role, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import type { LinkResultDTO } from '../../domain/contracts';
import type { VerifiedIdentity } from './firebase.service';

/**
 * Owns the account-vs-identity model. A User is the canonical account; each
 * AuthIdentity is one way to log in. This service resolves logins, links new
 * identities to an existing account, and merges two accounts when a linked
 * identity already belongs to someone else — all without duplicating or losing
 * data. See the design notes in the auth module for the merge rules.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve a fresh login: return the user behind this identity, or provision a
   * brand-new CUSTOMER account if the identity has never been seen. Never merges
   * based on a matching phone/email — that only happens via explicit linking.
   */
  async resolveLogin(id: VerifiedIdentity, shopId?: string): Promise<User> {
    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: id.provider, subject: id.subject } },
      include: { user: true },
    });
    if (existing) {
      await this.refreshSnapshots(existing.id, id);
      return existing.user;
    }

    const targetShopId = shopId ?? this.config.getOrThrow<string>('defaultShopId');
    const shop =
      (await this.prisma.shop.findUnique({ where: { id: targetShopId } })) ??
      (await this.prisma.shop.findFirst());
    if (!shop) throw ApiException.validation('No shop is configured.');

    return this.prisma.user.create({
      data: {
        phone: id.phone,
        email: id.email,
        name: id.name,
        memberships: { create: { shopId: shop.id, role: Role.CUSTOMER } },
        identities: {
          create: {
            provider: id.provider,
            subject: id.subject,
            emailSnapshot: id.email,
            phoneSnapshot: id.phone,
          },
        },
      },
    });
  }

  /**
   * Attach an identity to the currently-signed-in user. If the identity already
   * belongs to a *different* account, we do NOT merge unless `confirmMerge` is
   * set — instead we report what would be merged so the client can confirm.
   */
  async linkIdentity(
    currentUserId: string,
    id: VerifiedIdentity,
    confirmMerge = false,
  ): Promise<LinkResultDTO> {
    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: id.provider, subject: id.subject } },
    });

    if (!existing) {
      await this.prisma.authIdentity.create({
        data: {
          userId: currentUserId,
          provider: id.provider,
          subject: id.subject,
          emailSnapshot: id.email,
          phoneSnapshot: id.phone,
        },
      });
      await this.fillProfileBlanks(currentUserId, id);
      return { status: 'linked' };
    }

    if (existing.userId === currentUserId) return { status: 'already_linked' };

    // The identity belongs to another account. Surface a merge confirmation
    // (with how much data the other account holds) unless already confirmed.
    if (!confirmMerge) {
      const otherId = existing.userId;
      const [bookings, vehicles] = await Promise.all([
        this.prisma.booking.count({ where: { customer: { userId: otherId } } }),
        this.prisma.vehicle.count({ where: { membership: { userId: otherId } } }),
      ]);
      return { status: 'merge_required', conflict: { bookings, vehicles } };
    }

    await this.prisma.$transaction((tx) => this.merge(tx, currentUserId, existing.userId));
    return { status: 'merged' };
  }

  /** Remove a provider's identity from the current user. Can't remove the last one. */
  async unlinkIdentity(currentUserId: string, provider: AuthProvider): Promise<void> {
    const count = await this.prisma.authIdentity.count({ where: { userId: currentUserId } });
    if (count <= 1) {
      throw ApiException.validation("You can't remove your only login method.");
    }
    const ident = await this.prisma.authIdentity.findFirst({
      where: { userId: currentUserId, provider },
    });
    if (!ident) throw ApiException.notFound("That login method isn't linked.");
    await this.prisma.authIdentity.delete({ where: { id: ident.id } });
  }

  /**
   * Fold `mergedId` into `survivorId` in one transaction: re-parent owned data,
   * move identities, fill (never overwrite) survivor profile blanks, delete the
   * emptied account.
   */
  private async merge(
    tx: Prisma.TransactionClient,
    survivorId: string,
    mergedId: string,
  ): Promise<void> {
    if (survivorId === mergedId) return;

    const mergedMemberships = await tx.membership.findMany({ where: { userId: mergedId } });
    const survivorMemberships = await tx.membership.findMany({ where: { userId: survivorId } });

    for (const mm of mergedMemberships) {
      const dup = survivorMemberships.find((s) => s.shopId === mm.shopId && s.role === mm.role);
      if (!dup) {
        // Survivor has no membership for this shop+role → just re-point it.
        await tx.membership.update({ where: { id: mm.id }, data: { userId: survivorId } });
      } else {
        // Survivor already acts in this shop+role → move children, drop the dup.
        await tx.vehicle.updateMany({ where: { membershipId: mm.id }, data: { membershipId: dup.id } });
        await tx.booking.updateMany({ where: { customerMembershipId: mm.id }, data: { customerMembershipId: dup.id } });
        await tx.booking.updateMany({ where: { pickupMembershipId: mm.id }, data: { pickupMembershipId: dup.id } });
        await tx.booking.updateMany({ where: { serviceMembershipId: mm.id }, data: { serviceMembershipId: dup.id } });
        await tx.membership.delete({ where: { id: mm.id } });
      }
    }

    // Move every login method onto the survivor.
    await tx.authIdentity.updateMany({ where: { userId: mergedId }, data: { userId: survivorId } });

    // Fill survivor's blank profile fields from the merged account (no overwrite).
    const survivor = await tx.user.findUniqueOrThrow({ where: { id: survivorId } });
    const merged = await tx.user.findUniqueOrThrow({ where: { id: mergedId } });
    await tx.user.update({
      where: { id: survivorId },
      data: {
        name: survivor.name ?? merged.name,
        email: survivor.email ?? merged.email,
        phone: survivor.phone ?? merged.phone,
      },
    });

    // The merged account now owns nothing; remove it (cascades its refresh tokens).
    await tx.user.delete({ where: { id: mergedId } });
  }

  private async fillProfileBlanks(userId: string, id: VerifiedIdentity): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const data: Prisma.UserUpdateInput = {};
    if (!user.phone && id.phone) data.phone = id.phone;
    if (!user.email && id.email) data.email = id.email;
    if (!user.name && id.name) data.name = id.name;
    if (Object.keys(data).length) await this.prisma.user.update({ where: { id: userId }, data });
  }

  private async refreshSnapshots(identityId: string, id: VerifiedIdentity): Promise<void> {
    await this.prisma.authIdentity.update({
      where: { id: identityId },
      data: { emailSnapshot: id.email, phoneSnapshot: id.phone },
    });
  }
}
