/** Mobile genDoc template slugs (see apps/fordan-crm-mobile CEC compliance models). */
export const JOB_DOCUMENT_TEMPLATE_CATALOG: Record<
  string,
  { title: string; subtitle: string }
> = {
  doc_swms: {
    title: 'SWMS',
    subtitle: 'Safe Work Method Statement',
  },
  doc_cec_declaration: {
    title: 'CEC declaration',
    subtitle: 'Installer declaration for CEC compliance',
  },
  doc_install_cert: {
    title: 'Installation certificate',
    subtitle: 'Post-install certification',
  },
  doc_handover: {
    title: 'Customer handover',
    subtitle: 'Handover checklist and sign-off',
  },
  doc_grid_letter: {
    title: 'Grid connection letter',
    subtitle: 'Utility / DNSP correspondence',
  },
};

export function resolveJobDocumentTemplateTitle(templateId: string): string {
  return JOB_DOCUMENT_TEMPLATE_CATALOG[templateId]?.title ?? templateId;
}
