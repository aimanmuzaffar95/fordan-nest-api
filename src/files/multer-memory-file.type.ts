/** Shape of files produced by `multer` memory storage (no `path`). */
export type MulterMemoryFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};
