import { UserRole } from '../entities/user-role.enum';

export type UserSummaryDto = {
  id: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  role: UserRole;
};
