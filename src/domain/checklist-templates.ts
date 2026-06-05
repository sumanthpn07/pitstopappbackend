// Per-service task checklists employees work through. Keyed by the seeded
// service ids; manager-created services fall back to the default list.

const DEFAULT_CHECKLIST = [
  'Inspect & note existing condition',
  'Perform the service',
  'Quality check',
  'Final inspection & handover',
];

export const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  svc_wash: ['Pre-rinse & wheel clean', 'Foam application', 'Hand wash all panels', 'Rinse & dry', 'Glass & final wipe-down', 'Final inspection'],
  svc_foam: ['Snow-foam pre-soak', 'pH-neutral hand wash', 'Wheels & tyres', 'Rinse & hand dry', 'Apply carnauba wax', 'Buff & inspect'],
  svc_interior: ['Remove mats & clutter', 'Vacuum seats & carpets', 'Steam-clean upholstery', 'Wipe dashboard & trim', 'Clean interior glass', 'Odour treatment & inspection'],
  svc_full: ['Exterior foam wash', 'Clay bar decontamination', 'Wheels & arches', 'Interior vacuum & steam', 'Dress trim & tyres', 'Wax / sealant', 'Final inspection'],
  svc_ceramic: ['Wash & decontaminate', 'Clay bar treatment', 'Machine paint correction', 'IPA wipe-down', 'Apply 9H ceramic coat', 'Infrared cure', 'Final inspection'],
  svc_headlight: ['Mask surrounding trim', 'Wet-sand oxidation', 'Polish to clarity', 'Apply UV sealant', 'Final inspection'],
};

export function checklistFor(serviceId: string): string[] {
  return CHECKLIST_TEMPLATES[serviceId] ?? DEFAULT_CHECKLIST;
}
