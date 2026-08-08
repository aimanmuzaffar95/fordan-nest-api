import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { CustomersService } from './customers.service';
import { CreateCustomerNoteDto } from './dto/customer-note.dto';
import { CustomerNote } from './entities/customer-note.entity';

export interface CustomerNoteViewer {
  userId: string;
  role: UserRole;
  customerScope?: 'all' | 'own';
}

export interface CustomerNoteResponse {
  id: string;
  customerId: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
  } | null;
}

@Injectable()
export class CustomerNotesService {
  constructor(
    @InjectRepository(CustomerNote)
    private readonly notesRepo: Repository<CustomerNote>,
    private readonly customersService: CustomersService,
  ) {}

  private async assertCustomerVisible(
    customerId: string,
    viewer: CustomerNoteViewer,
  ): Promise<void> {
    // Reuses the same viewer-scoped lookup as the customer detail endpoint
    // (throws NotFoundException if out of scope / missing).
    await this.customersService.findOne(customerId, viewer);
  }

  private map(note: CustomerNote): CustomerNoteResponse {
    const user = note.createdByUser;
    const firstName = user?.firstName?.trim() ?? '';
    const lastName = user?.lastName?.trim() ?? '';
    return {
      id: note.id,
      customerId: note.customerId,
      body: note.body,
      pinned: note.pinned,
      createdAt: note.createdAt,
      createdBy: user
        ? {
            id: user.id,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
          }
        : null,
    };
  }

  async listForCustomer(
    customerId: string,
    viewer: CustomerNoteViewer,
  ): Promise<CustomerNoteResponse[]> {
    await this.assertCustomerVisible(customerId, viewer);
    const notes = await this.notesRepo.find({
      where: { customerId },
      relations: { createdByUser: true },
      order: { pinned: 'DESC', createdAt: 'DESC' },
    });
    return notes.map((note) => this.map(note));
  }

  async create(
    customerId: string,
    dto: CreateCustomerNoteDto,
    viewer: CustomerNoteViewer,
  ): Promise<CustomerNoteResponse> {
    await this.assertCustomerVisible(customerId, viewer);
    const saved = await this.notesRepo.save(
      this.notesRepo.create({
        customerId,
        body: dto.body,
        pinned: dto.pinned ?? false,
        // Author is always the authenticated principal — never client input.
        createdByUserId: viewer.userId,
      }),
    );
    const created = await this.notesRepo.findOne({
      where: { id: saved.id },
      relations: { createdByUser: true },
    });
    if (!created)
      throw new NotFoundException('Customer note not found after save');
    return this.map(created);
  }

  async remove(
    id: string,
    viewer: CustomerNoteViewer,
  ): Promise<{ deleted: true }> {
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete customer notes');
    }
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException(`Customer note ${id} not found`);
    await this.assertCustomerVisible(note.customerId, viewer);
    await this.notesRepo.delete({ id });
    return { deleted: true };
  }
}
