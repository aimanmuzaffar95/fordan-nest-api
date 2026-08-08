import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateProjectNoteDto } from './dto/project-note.dto';
import { ProjectNote } from './entities/project-note.entity';
import { Project } from './entities/project.entity';

export interface ProjectNoteResponse {
  id: string;
  projectId: string;
  body: string;
  createdAt: Date;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
  } | null;
}

@Injectable()
export class ProjectNotesService {
  constructor(
    @InjectRepository(ProjectNote)
    private readonly notesRepo: Repository<ProjectNote>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
  ) {}

  /**
   * Read access only, scoped to assignment — not a blanket open-up.
   *
   * Installers already read visits and defects for a project; the timeline
   * notes on the same project are the same audience's read, so the crew on
   * site can see why a milestone/permit/visit changed status. Matches the
   * assignment check `JobsService.assertInstallerJobAccess` uses: either the
   * job's primary installer or a direct `assignments` row for that job. Write
   * and delete stay Admin/Manager-only (enforced by `@Roles` on the
   * controller) — this only widens `GET /projects/:id/notes`.
   */
  private async assertInstallerNoteAccess(
    project: Project,
    userId: string,
  ): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: project.jobId } });
    if (job?.assignedStaffUserId === userId) return;

    const hasAssignment = await this.assignmentRepo.count({
      where: { jobId: project.jobId, staffUserId: userId },
    });
    if (hasAssignment > 0) return;

    throw new ForbiddenException('That project is not one of yours');
  }

  private async loadProject(
    projectId: string,
    viewer: { userId: string; role: UserRole },
    action: 'read' | 'write' = 'write',
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (
      viewer.role === UserRole.MANAGER &&
      project.projectManagerUserId !== viewer.userId
    ) {
      throw new ForbiddenException('That project is not one of yours');
    }
    if (action === 'read' && viewer.role === UserRole.INSTALLER) {
      await this.assertInstallerNoteAccess(project, viewer.userId);
    }
    return project;
  }

  private map(note: ProjectNote): ProjectNoteResponse {
    const user = note.createdByUser;
    const firstName = user?.firstName?.trim() ?? '';
    const lastName = user?.lastName?.trim() ?? '';
    return {
      id: note.id,
      projectId: note.projectId,
      body: note.body,
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

  async listForProject(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProjectNoteResponse[]> {
    await this.loadProject(projectId, viewer, 'read');
    const notes = await this.notesRepo.find({
      where: { projectId },
      relations: { createdByUser: true },
      order: { createdAt: 'DESC' },
    });
    return notes.map((note) => this.map(note));
  }

  async create(
    projectId: string,
    dto: CreateProjectNoteDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProjectNoteResponse> {
    await this.loadProject(projectId, viewer);
    const saved = await this.notesRepo.save(
      this.notesRepo.create({
        projectId,
        body: dto.body,
        // Author is always the authenticated principal — never client input.
        createdByUserId: viewer.userId,
      }),
    );
    const created = await this.notesRepo.findOne({
      where: { id: saved.id },
      relations: { createdByUser: true },
    });
    if (!created)
      throw new NotFoundException('Project note not found after save');
    return this.map(created);
  }

  async remove(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<{ deleted: true }> {
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete project notes');
    }
    const note = await this.notesRepo.findOne({ where: { id } });
    if (!note) throw new NotFoundException(`Project note ${id} not found`);
    await this.loadProject(note.projectId, viewer);
    await this.notesRepo.delete({ id });
    return { deleted: true };
  }
}
