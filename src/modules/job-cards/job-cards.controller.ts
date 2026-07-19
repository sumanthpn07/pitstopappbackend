import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { JobCardStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { JobCardsService } from './job-cards.service';
import type {
  CreateJobCardDto,
  TransitionJobCardDto,
  LogPartsDto,
  AddNoteDto,
  CancelJobCardDto,
} from './dto';

@Controller('job-cards')
export class JobCardsController {
  constructor(private readonly jobCardsService: JobCardsService) {}

  /** Create a new job card with vehicle record and selected services. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateJobCardDto) {
    return this.jobCardsService.create(dto);
  }

  /** List job cards for the current tenant, optionally filtered by status. */
  @Get()
  list(@CurrentUser() auth: AuthContext, @Query('status') status?: string) {
    const parsedStatus = status ? (status as JobCardStatus) : undefined;
    return this.jobCardsService.list(parsedStatus, auth.userId);
  }

  /** Get a single job card with items, parts, and notes. */
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.jobCardsService.findById(id);
  }

  /** Transition job card state (state machine enforcement). */
  @Patch(':id/transition')
  transition(@Param('id') id: string, @Body() dto: TransitionJobCardDto) {
    return this.jobCardsService.transition(id, dto);
  }

  /** Log parts consumption for a job card. */
  @Post(':id/parts')
  @HttpCode(HttpStatus.CREATED)
  logParts(@Param('id') id: string, @Body() dto: LogPartsDto) {
    return this.jobCardsService.logParts(id, dto);
  }

  /** Add a labor note to a job card. */
  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.jobCardsService.addNote(id, auth.userId, dto);
  }

  /** Cancel a job card (with optional reversal reason if parts were consumed). */
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelJobCardDto) {
    return this.jobCardsService.cancel(id, dto);
  }
}
