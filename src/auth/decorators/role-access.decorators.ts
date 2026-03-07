import { UserRole } from '../../users/entities/user-role.enum';
import { Roles } from './roles.decorator';

export const AdminOnly = () => Roles(UserRole.ADMIN);
export const ManagerOnly = () => Roles(UserRole.MANAGER);
export const InstallerOnly = () => Roles(UserRole.INSTALLER);
