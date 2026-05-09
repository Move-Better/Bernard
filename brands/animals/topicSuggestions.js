// Curated topic database for Move Better Animals Chiropractic — built around
// the conditions and questions Portland and Vancouver pet owners actually
// search for. Tone is warm, accessible, education-forward; vocabulary is
// "your dog" / "your cat" / "your pet," never "patient." Care is positioned
// as complementary to veterinary medicine, never a replacement.
//
// priority: 'high' = very high pet-owner search volume, 'medium' = solid
//           volume or strong educational opportunity, 'low' = niche but
//           relevant to Whitney's caseload or a Move Better differentiator.

export const TOPIC_SUGGESTIONS = [
  // ── Spine & Disc Disease ────────────────────────────────────────────────
  {
    topic: 'IVDD (intervertebral disc disease) in dogs',
    category: 'Spine & Disc Disease',
    priority: 'high',
    keywords: ['ivdd', 'disc disease', 'intervertebral', 'slipped disc', 'ruptured disc'],
    audienceNote: 'Dachshunds, French bulldogs, and corgis are everywhere in Portland — this is the #1 spine question owners search after a vet flags a disc',
  },
  {
    topic: 'Neck pain & cervical stiffness',
    category: 'Spine & Disc Disease',
    priority: 'high',
    keywords: ['neck pain', 'cervical', 'stiff neck', 'low head carriage'],
    audienceNote: 'Owners often describe it as "head held funny" or "won\'t look up" — high educational value',
  },
  {
    topic: 'Back pain in dogs',
    category: 'Spine & Disc Disease',
    priority: 'high',
    keywords: ['back pain', 'sore back', 'spine pain', 'dog back'],
    audienceNote: 'Broad search term — entry point for owners who don\'t yet know terms like IVDD or spondylosis',
  },
  {
    topic: 'Wobbler syndrome in large-breed dogs',
    category: 'Spine & Disc Disease',
    priority: 'medium',
    keywords: ['wobbler', 'cervical spondylomyelopathy', 'csm'],
    audienceNote: 'Great Danes, Dobermans, and Bernese mountain dogs are common in PNW outdoors households',
  },
  {
    topic: 'Lumbosacral disease in senior dogs',
    category: 'Spine & Disc Disease',
    priority: 'medium',
    keywords: ['lumbosacral', 'cauda equina', 'lower back', 'tail base pain'],
    audienceNote: 'Older German Shepherds, Labs, and working-line dogs — owners often see slow tail drop first',
  },

  // ── Hips & Pelvis ───────────────────────────────────────────────────────
  {
    topic: 'Hip dysplasia in dogs',
    category: 'Hips & Pelvis',
    priority: 'high',
    keywords: ['hip dysplasia', 'hip displasia', 'bad hips'],
    audienceNote: 'Top searched canine orthopedic condition — owners actively seek non-surgical options before FHO or THR',
  },
  {
    topic: 'Hip arthritis & senior pet stiffness',
    category: 'Hips & Pelvis',
    priority: 'high',
    keywords: ['hip arthritis', 'arthritis', 'osteoarthritis', 'oa', 'stiff hips'],
    audienceNote: 'The "she\'s just slowing down" conversation — strongest content opportunity for senior pet owners',
  },
  {
    topic: 'Pelvic misalignment after a slip or fall',
    category: 'Hips & Pelvis',
    priority: 'medium',
    keywords: ['pelvic', 'pelvis', 'slip', 'fall', 'crooked walk', 'asymmetric gait'],
    audienceNote: 'Wet PNW weather + slippery floors and stairs — common acute presentation Whitney sees regularly',
  },

  // ── Limbs & Joints ──────────────────────────────────────────────────────
  {
    topic: 'Limping with no clear cause',
    category: 'Limbs & Joints',
    priority: 'high',
    keywords: ['limping', 'limp', 'lame', 'lameness', 'unexplained limp'],
    audienceNote: 'High-volume owner search — exactly the case where a chiropractic exam catches what radiographs miss',
  },
  {
    topic: 'Cruciate (CCL) ligament injury',
    category: 'Limbs & Joints',
    priority: 'high',
    keywords: ['ccl', 'cruciate', 'acl', 'tplo', 'knee ligament', 'torn knee'],
    audienceNote: 'Most common orthopedic injury in dogs — owners researching alternatives or post-op support',
  },
  {
    topic: 'Elbow dysplasia in young dogs',
    category: 'Limbs & Joints',
    priority: 'medium',
    keywords: ['elbow dysplasia', 'elbow', 'fcp', 'ununited anconeal'],
    audienceNote: 'Common in Labs, Goldens, Bernese, and Rottweilers — prime Vancouver / west-side Portland breed mix',
  },
  {
    topic: 'Patellar luxation in small breeds',
    category: 'Limbs & Joints',
    priority: 'medium',
    keywords: ['patellar luxation', 'luxating patella', 'trick knee', 'skipping gait'],
    audienceNote: 'Pomeranians, Yorkies, Chihuahuas, and Frenchies — the "skipping a beat" walk owners describe',
  },
  {
    topic: 'Iliopsoas strain in athletic dogs',
    category: 'Limbs & Joints',
    priority: 'medium',
    keywords: ['iliopsoas', 'hip flexor', 'groin strain', 'agility injury'],
    audienceNote: 'Underdiagnosed — agility, dock diving, and weekend-warrior trail dogs all present with it',
  },
  {
    topic: 'Shoulder pain & instability',
    category: 'Limbs & Joints',
    priority: 'medium',
    keywords: ['shoulder pain', 'shoulder instability', 'medial shoulder', 'biceps tendon'],
    audienceNote: 'Common in mid-size sporting and herding dogs that pull on leash through Forest Park trails',
  },

  // ── Senior Pets & Mobility Decline ──────────────────────────────────────
  {
    topic: 'Slowing down on walks',
    category: 'Senior Pets & Mobility',
    priority: 'high',
    keywords: ['slowing down', 'slower walks', 'tired on walks', 'short walks'],
    audienceNote: 'The earliest sign owners notice — entry point to talking about aging vs. treatable musculoskeletal pain',
  },
  {
    topic: 'Trouble getting up from rest',
    category: 'Senior Pets & Mobility',
    priority: 'high',
    keywords: ['trouble standing', 'hard time getting up', 'slow to rise', 'getting up'],
    audienceNote: 'Classic morning-stiffness presentation — owners often dismiss it as "just old age"',
  },
  {
    topic: 'Stairs and jumping struggles',
    category: 'Senior Pets & Mobility',
    priority: 'high',
    keywords: ['stairs', 'jumping', 'won\'t use stairs', 'can\'t jump on couch', 'won\'t jump in car'],
    audienceNote: 'Concrete owner observation that translates well to before/after content',
  },
  {
    topic: 'Hind-end weakness in senior dogs',
    category: 'Senior Pets & Mobility',
    priority: 'high',
    keywords: ['hind end weakness', 'rear weakness', 'wobbly back legs', 'dragging back legs'],
    audienceNote: 'Important to differentiate orthopedic causes from neurologic (DM, IVDD) — strong vet-collaboration angle',
  },
  {
    topic: 'Quality-of-life support for older pets',
    category: 'Senior Pets & Mobility',
    priority: 'medium',
    keywords: ['quality of life', 'senior care', 'aging gracefully', 'comfort care'],
    audienceNote: 'Owners weighing "is it time" decisions — chiropractic content can show another step before that',
  },

  // ── Cats ────────────────────────────────────────────────────────────────
  {
    topic: 'Cat arthritis & mobility decline',
    category: 'Cats',
    priority: 'medium',
    keywords: ['cat arthritis', 'feline arthritis', 'cat oa', 'old cat stiff'],
    audienceNote: 'Vastly under-recognized — most cats over 12 have OA but owners rarely connect behavior changes to pain',
  },
  {
    topic: 'Cat stiffness & jumping changes',
    category: 'Cats',
    priority: 'medium',
    keywords: ['cat stiff', 'cat won\'t jump', 'cat hesitating', 'cat jumping'],
    audienceNote: 'The "she used to jump on the counter" conversation — a great cat-specific entry point',
  },
  {
    topic: 'Litter box behavior changes from back pain',
    category: 'Cats',
    priority: 'low',
    keywords: ['litter box', 'house soiling', 'going outside box', 'cat peeing'],
    audienceNote: 'Often misread as behavioral when the cause is musculoskeletal — chiropractic discovery angle',
  },
  {
    topic: 'Senior cat muscle wasting & weight loss',
    category: 'Cats',
    priority: 'low',
    keywords: ['cat muscle loss', 'sarcopenia', 'cat losing muscle', 'cat weight loss'],
    audienceNote: 'Pair with vet workup — chiropractic supports mobility while medical workup runs in parallel',
  },

  // ── Post-Surgical & Trauma Recovery ─────────────────────────────────────
  {
    topic: 'Post-TPLO / cruciate surgery rehab',
    category: 'Post-Surgical & Recovery',
    priority: 'medium',
    keywords: ['tplo', 'post tplo', 'cruciate surgery', 'after knee surgery'],
    audienceNote: 'Surgeon-referred owners actively look for adjunct care during the 8–12 week recovery window',
  },
  {
    topic: 'Post-spay / neuter gait changes',
    category: 'Post-Surgical & Recovery',
    priority: 'medium',
    keywords: ['post spay', 'post neuter', 'after surgery gait', 'spay recovery'],
    audienceNote: 'Subtle pelvic and lumbar tension after positioning — owners often notice "she walks weird now"',
  },
  {
    topic: 'Recovery from a car accident or fall',
    category: 'Post-Surgical & Recovery',
    priority: 'medium',
    keywords: ['hit by car', 'fall', 'trauma', 'after accident'],
    audienceNote: 'After ER and vet workup clears acute injury, owners want help with the lingering stiffness',
  },
  {
    topic: 'Returning to activity after orthopedic surgery',
    category: 'Post-Surgical & Recovery',
    priority: 'medium',
    keywords: ['return to activity', 'return to sport', 'back to running', 'rehab milestones'],
    audienceNote: 'Sport-dog handlers in PNW want a partner for the bridge between "cleared by surgeon" and "back to competing"',
  },

  // ── Working & Sport Dogs (PNW) ──────────────────────────────────────────
  {
    topic: 'Agility dog injuries & soundness',
    category: 'Working & Sport Dogs',
    priority: 'medium',
    keywords: ['agility', 'agility injury', 'agility dog', 'weave poles', 'a-frame'],
    audienceNote: 'Portland has a strong agility community — DASH, Columbia, and several training clubs nearby',
  },
  {
    topic: 'Dock diving injuries',
    category: 'Working & Sport Dogs',
    priority: 'medium',
    keywords: ['dock diving', 'dock dogs', 'splash dogs', 'dock jumping'],
    audienceNote: 'Vancouver Lake and Columbia River clubs make this a regional sport — repetitive launch injuries are common',
  },
  {
    topic: 'Hunting & retrieving dog soreness',
    category: 'Working & Sport Dogs',
    priority: 'medium',
    keywords: ['hunting dog', 'gun dog', 'retriever', 'field trial', 'upland', 'waterfowl'],
    audienceNote: 'Oregon waterfowl season runs Oct–Jan — Labs and Chessies come in stiff after long days in cold water',
  },
  {
    topic: 'Herding dog soundness',
    category: 'Working & Sport Dogs',
    priority: 'low',
    keywords: ['border collie', 'australian shepherd', 'herding', 'sheepdog', 'cattle dog'],
    audienceNote: 'Willamette Valley farms and sheepdog trials keep BCs, Aussies, and Heelers in active work year-round',
  },
  {
    topic: 'Trail running with your dog',
    category: 'Working & Sport Dogs',
    priority: 'medium',
    keywords: ['trail running', 'running with dog', 'canicross', 'dog trail'],
    audienceNote: 'Forest Park\'s Wildwood Trail is a daily route for thousands of Portland dogs — overuse content fits',
  },
  {
    topic: 'Hiking-companion dogs in the Gorge & Mt Hood',
    category: 'Working & Sport Dogs',
    priority: 'medium',
    keywords: ['hiking dog', 'backpacking dog', 'pacific crest', 'columbia gorge'],
    audienceNote: 'Steep grades and uneven volcanic rock load shoulders and elbows differently than flat city walks',
  },

  // ── Behavior & Subtle Signs of Pain ─────────────────────────────────────
  {
    topic: 'Reluctance to be touched on back or hips',
    category: 'Behavior & Subtle Signs',
    priority: 'medium',
    keywords: ['won\'t be petted', 'flinches', 'sensitive to touch', 'reactive to back'],
    audienceNote: 'Easy owner-recognizable pain signal — concrete chip that drives bookings',
  },
  {
    topic: 'Behavior changes that signal pain',
    category: 'Behavior & Subtle Signs',
    priority: 'medium',
    keywords: ['behavior change', 'grumpy dog', 'irritable', 'snapping', 'anxious'],
    audienceNote: 'Trainers in Portland increasingly refer owners to rule out pain before behavior modification',
  },
  {
    topic: 'Yelping when picked up or moved',
    category: 'Behavior & Subtle Signs',
    priority: 'low',
    keywords: ['yelp', 'crying', 'whimper', 'yelping when lifted'],
    audienceNote: 'Acute presentation — frame as "see your vet first, then chiropractic for the recovery"',
  },
  {
    topic: 'Refusing to jump in the car',
    category: 'Behavior & Subtle Signs',
    priority: 'low',
    keywords: ['won\'t jump in car', 'car jump', 'tailgate', 'car ramp'],
    audienceNote: 'PNW tailgate-and-trailhead culture — owners notice this exact change before anything else',
  },

  // ── Wellness & Prevention ───────────────────────────────────────────────
  {
    topic: 'Toenail length & posture',
    category: 'Wellness & Prevention',
    priority: 'medium',
    keywords: ['toenails', 'long nails', 'dog nails', 'nail trimming', 'posture'],
    audienceNote: 'One of Whitney\'s signature blog topics — concrete, actionable, owners can act on it the same day',
  },
  {
    topic: 'Slip-and-fall prevention at home',
    category: 'Wellness & Prevention',
    priority: 'low',
    keywords: ['slippery floors', 'rugs', 'traction', 'fall prevention', 'hardwood floors'],
    audienceNote: 'Portland craftsman homes = lots of hardwood — rugs and traction socks are easy senior-pet wins',
  },
  {
    topic: 'Crate rest vs activity during recovery',
    category: 'Wellness & Prevention',
    priority: 'low',
    keywords: ['crate rest', 'restricted activity', 'recovery', 'when to walk'],
    audienceNote: 'Owners struggle with active dogs on crate rest — content can frame chiropractic\'s role in safe re-loading',
  },
  {
    topic: 'Puppy growth & joint development',
    category: 'Wellness & Prevention',
    priority: 'low',
    keywords: ['puppy joints', 'puppy growth', 'large breed puppy', 'growth plates'],
    audienceNote: 'New-puppy owners researching how much exercise is too much — early-relationship content',
  },

  // ── Vet-Complementary Care ──────────────────────────────────────────────
  {
    topic: 'When to see your vet vs your animal chiropractor',
    category: 'Vet-Complementary Care',
    priority: 'medium',
    keywords: ['vet vs chiropractor', 'when to see vet', 'when to see chiropractor', 'who to call'],
    audienceNote: 'Direct answer to the most common owner question — clarifies the complementary relationship',
  },
  {
    topic: 'What an AVCA-certified visit looks like',
    category: 'Vet-Complementary Care',
    priority: 'medium',
    keywords: ['avca', 'animal chiropractic visit', 'first visit', 'what to expect'],
    audienceNote: 'AVCA certification is the credential that matters — most owners have never heard of it',
  },
  {
    topic: 'Chiropractic alongside PT and rehab',
    category: 'Vet-Complementary Care',
    priority: 'medium',
    keywords: ['rehab', 'physical therapy', 'ccrt', 'underwater treadmill', 'rehab and chiropractic'],
    audienceNote: 'Several PNW rehab clinics — owners want to know how chiropractic fits in, not whether to choose',
  },
  {
    topic: 'Chiropractic before considering surgery',
    category: 'Vet-Complementary Care',
    priority: 'medium',
    keywords: ['before surgery', 'avoid surgery', 'conservative care', 'surgical alternative'],
    audienceNote: 'High-intent owner search — directly aligned with Move Better\'s "first resort, not last resort" positioning',
  },
  {
    topic: 'Talking with your vet about chiropractic care',
    category: 'Vet-Complementary Care',
    priority: 'low',
    keywords: ['tell my vet', 'vet referral', 'vet collaboration', 'integrative care'],
    audienceNote: 'Reassures owners worried about offending their vet — supports the complementary positioning explicitly',
  },
]

/**
 * Returns suggestions sorted by coverage gap:
 * uncovered high-priority topics first, then underrepresented ones.
 * existingTopics: array of topic strings from actual interviews in Supabase.
 */
export function getSuggestedTopics(existingTopics = []) {
  const normalized = existingTopics.map((t) => t.toLowerCase())

  function coverageCount(suggestion) {
    return normalized.filter((t) =>
      suggestion.keywords.some((k) => t.includes(k.toLowerCase()))
    ).length
  }

  const priorityRank = { high: 3, medium: 2, low: 1 }

  return TOPIC_SUGGESTIONS.map((s) => ({
    ...s,
    interviewCount: coverageCount(s),
  })).sort((a, b) => {
    // Uncovered beats covered
    if (a.interviewCount === 0 && b.interviewCount > 0) return -1
    if (a.interviewCount > 0 && b.interviewCount === 0) return 1
    // Among same coverage status, higher priority first
    const pd = priorityRank[b.priority] - priorityRank[a.priority]
    if (pd !== 0) return pd
    // Fewest interviews first (needs more content)
    return a.interviewCount - b.interviewCount
  })
}
