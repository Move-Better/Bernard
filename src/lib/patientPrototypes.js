// Patient prototype selector — driven by workspace.patient_context.prototypes.
// First entry (id: null) is the "all patients" default. Workspaces with no
// prototypes (equine, animals, fresh self-onboarded tenants) return only
// that first entry, and the selector is effectively hidden in the UI.
//
// Lives in its own module (not prompts.js) so eagerly-loaded pages (Home)
// can import it without pulling the entire ~100 KB prompt library into the
// main bundle. prompts.js re-exports it for existing consumers.
export function getPatientPrototypesUi(workspace) {
  const prototypes = workspace?.patient_context?.prototypes
  const list = Array.isArray(prototypes) ? prototypes : []
  return [
    {
      id: null,
      label: 'All patients',
      emoji: '✨',
      description: 'No specific archetype — AI draws on the full patient base',
    },
    ...list.map((p) => ({
      id: p.id,
      label: p.shortLabel || p.label,
      emoji: p.emoji || '',
      description: p.coreDesire,
    })),
  ]
}
