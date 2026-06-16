import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { FirebaseService } from './firebase.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService, FirebaseService],
  exports: [TokensService],
})
export class AuthModule {}
