// ============================================================================
// LUXEDGE — PRODUCT BUYER CONTENT (shared, crawled AND rendered)
//
// WHY THIS FILE EXISTS
// AdSense reviewed luxedge.us as "Low value content". Measured on production,
// 46 of 62 indexable URLs carried under 300 words of visible text, and a
// product page carried about 25 words of product copy: one sentence plus two
// bullets. Google's thin-content guidance is exactly that profile.
//
// The catalog cannot fill the gap on its own: `features` and `specifications`
// are EMPTY for every product, and only one variant row exists catalogue-wide,
// so there are no dimensions, materials, weight limits or option lists to
// publish. Inventing them is not an option — a wrong specification on an
// animal-care product is worse than a short page.
//
// So this file adds only what is honestly knowable:
//   summary  — what the listing is and which animal/use it suits. Restates the
//              product's own published name; it never adds a new fact.
//   confirm  — what a buyer should check before ordering. Where a fact is
//              missing (no size chart, no weight rating) this says so plainly
//              instead of implying one exists.
//   care     — standard, widely-documented handling and safety practice for
//              this KIND of product. Not a claim about this unit's materials,
//              durability or performance.
//   guide    — a live Luxedge guide that genuinely helps with this product.
//
// MISSING FACTS ARE THE OWNER'S TO SUPPLY. Each entry's `needs` field lists the
// evidence required to make that page genuinely substantive (dimensions,
// material, capacity, washability, weight rating). When the owner supplies
// them, publish them as real `specifications` instead of prose — see
// NEEDS_OWNER_EVIDENCE at the bottom of this file.
//
// Rendered in two places so crawlers and visitors cannot diverge:
//   - worker/seo-meta.ts  → injectProductBody (server-rendered HTML)
//   - src/App.tsx         → the product detail page (after hydration)
// ============================================================================

import { isLinkablePublicPath } from './reviewHolds';

export interface ProductContent {
  /** What the listing is, and which animal or use it suits. */
  summary: string;
  /** Points worth confirming before ordering — including gaps we cannot answer. */
  confirm: string[];
  /** Standard care/safety practice for this kind of product. */
  care: string[];
  /** A live Luxedge guide that genuinely helps with this product. */
  guide?: { label: string; href: string };
  /** Facts missing from the catalogue that would make this page substantive. */
  needs: string[];
}

export const PRODUCT_CONTENT: Record<string, ProductContent> = {
  // ---------------------------------------------------------------- Bird Supplies
  'outdoor-hanging-bird-feeder': {
    summary:
      'A hanging seed station for garden birds, made to be left outdoors and refilled as it empties. It suits a garden, patio or balcony where something solid can carry a full feeder.',
    confirm: [
      'How you will hang it — the branch, hook or bracket has to take the weight of a full feeder.',
      'Where it goes: keep it clear of windows to reduce window strikes, and out of reach of pets.',
      'Seed type and capacity: suited for wild bird seed blends; confirm the reservoir capacity fits your refilling routine.',
    ],
    care: [
      'Clean and dry the feeder regularly. Dirty feeders are a common way disease spreads between garden birds.',
      'Throw away damp or mouldy seed rather than topping the feeder up over it.',
    ],
    guide: { label: 'How to choose the best bird feeder for your backyard', href: '/blog/best-bird-feeder-buyers-guide' },
    needs: ['dimensions', 'material', 'whether it is dishwasher-safe'],
  },
  'solar-bird-bath-fountain': {
    summary:
      'A round resin bird bath with a solar pump and light. It suits a sunny spot in a garden, where moving water also helps keep the bath fresher between changes.',
    confirm: [
      'Sunlight: solar panels need direct sun, so a shaded garden may not run the pump or the light reliably.',
      'Placement and mounting — check the photos and title for how this unit stands or mounts.',
      'Distance from cover, so birds can approach without being exposed.',
    ],
    care: [
      'Refresh the water often and scrub the bowl; standing water and debris are the main hygiene risk.',
      'In freezing weather, drain or bring it in so trapped water does not crack the bowl.',
    ],
    needs: ['bowl diameter', 'height', 'resin type', 'pump flow rate', 'frost resistance'],
  },

  // ----------------------------------------------------------------- Cat Supplies
  'cat-window-perch-suction-cup-hammock-seat-for-sunbathing': {
    summary:
      'A suction-mounted window hammock that gives a cat a raised, sunny place to rest without taking up floor space.',
    confirm: [
      'The surface it sticks to: suction cups need smooth, clean, non-porous glass. Textured, dusty or filmed surfaces will not hold.',
      'Weight: this page does not publish a rating; suited for standard single adult cats, but larger cats may exceed suction stability.',
      'Whether your cat will use it — many start on the floor beside it before jumping up.',
    ],
    care: [
      'Clean the glass and the cups before mounting, then re-seat the cups periodically and check they still hold.',
      'Warm rooms and direct sun can soften suction over time, so check the perch before your cat gets on it.',
    ],
    needs: ['fabric material', 'frame dimensions', 'whether the cover is removable'],
  },

  // ---------------------------------------------------------------------- Cattle
  'heavy-duty-cattle-feed-trough': {
    summary:
      'A poly feed trough for cattle and goats, sized for group feeding in a pen, paddock or barn.',
    confirm: [
      'Dimensions and capacity: the listing describes a rectangular poly trough for group pen feeding; confirm it suits your herd and daily ration.',
      'Footing — a full trough is heavy, so place it where the ground is level and will not rut.',
      'Access: smaller or horned animals may need a different height or shape to feed comfortably.',
    ],
    care: [
      'Empty and scrub it between feed types; old, damp feed is what sours a trough.',
      'Check the rim and base for cracks, especially if it is moved or dragged.',
    ],
    guide: { label: 'How to choose a cattle trough and feed/water setup', href: '/blog/how-to-choose-cattle-trough-feed-water-setup' },
    needs: ['exact dimensions', 'polyethylene grade', 'drain plug (yes/no)', 'UV stabilisation claim evidence'],
  },
  'portable-livestock-water-trough-30-gallon': {
    summary:
      'A collapsible water trough for livestock, intended for temporary pens, travel or moving between paddocks.',
    confirm: [
      'Capacity and dimensions — the listing names 30 gallons; confirm it fits your pen and your animals.',
      'Collapsing and re-erecting it repeatedly is the main wear point, so check the photographs for how the walls fold.',
      'Ground conditions: soft or stony ground is less stable for a portable trough.',
    ],
    care: [
      'Drain and dry it completely before folding it away, so it does not store damp.',
      'Rinse before refilling, particularly before moving it to different animals.',
    ],
    guide: { label: 'How to choose a cattle trough and feed/water setup', href: '/blog/how-to-choose-cattle-trough-feed-water-setup' },
    needs: ['exact dimensions', 'wall thickness', 'material', 'whether a drain valve is fitted'],
  },

  // ---------------------------------------------------------------- Dog Supplies
  'dog-clothes-spring-and-summer-clothing': {
    summary:
      'A lightweight cotton pet shirt for warm weather — the everyday option in this range rather than an insulating coat.',
    confirm: [
      'Fit around the chest and neck. The listing shows the size range it covers; measure your dog before ordering, because sizing is the usual reason these are returned.',
      'Length along the back, so it does not interfere when your dog sits or toilets.',
      'Whether your dog tolerates clothing at all — short, calm sessions indoors first is easier than starting outdoors.',
    ],
    care: [
      'Machine washable fabric should still be washed cool and air-dried to keep its shape.',
      'Check for rubbing under the front legs and around the neck after the first wear.',
    ],
    needs: ['size chart with measurements', 'exact fabric composition', 'care label instructions'],
  },
  'polka-dot-turtleneck-dog-sweater': {
    summary:
      'A ribbed polka-dot turtleneck top for small dogs — a light layer for cool rooms or short trips outdoors.',
    confirm: [
      'Neck fit: a turtleneck sits closer than an open collar, so measure the neck as well as the chest.',
      'Back length, so the hem does not catch when your dog sits.',
      'The size range on the listing, matched against your dog rather than a breed guess.',
    ],
    care: [
      'Wash cool and air-dry to limit shrinkage in ribbed knit.',
      'Take it off if your dog keeps scratching at the neck or under the front legs.',
    ],
    needs: ['size chart with measurements', 'fabric composition', 'care label instructions'],
  },
  'no-pull-dog-harness-with-reflective-strips-front-back-clip': {
    summary:
      'A walking harness with a front and a back attachment point and reflective strips, for dogs that pull and for walks in low light.',
    confirm: [
      'Chest measurement is what holds a harness in place, so measure the widest part of the chest behind the front legs and compare it with the listing.',
      'Which attachment you will use: the front point redirects a pulling dog, the back point suits relaxed walking.',
      'That it clears the throat and the armpits once fitted — that is the fit check, not a style preference.',
    ],
    care: [
      'Slide two flat fingers under every strap, then check the straps again after the first few minutes of walking.',
      'Inspect stitching, buckles, rings and reflective trim regularly and replace the harness if any of them are damaged.',
    ],
    guide: { label: 'How to fit a no-pull dog harness', href: '/blog/how-to-fit-no-pull-dog-harness' },
    needs: ['size chart with chest girth ranges', 'webbing material', 'hardware material and load rating evidence'],
  },
  'nylon-training-collar-quick-release': {
    summary:
      'A plain nylon training collar with a quick-release buckle — the everyday walking and identification collar.',
    confirm: [
      'Neck size: measure snugly at the base of the neck and add the allowance your dog needs.',
      'The buckle type, so you are confident it releases the way you expect if it catches on something.',
      'Whether an identification tag will be fitted, and how it attaches.',
    ],
    care: [
      'Check for fraying near the buckle, which is where a nylon collar wears first.',
      'Wash it by hand and dry it fully; dirt and salt left in the webbing stiffens it.',
    ],
    needs: ['neck size range', 'webbing width', 'buckle material', 'tag ring (yes/no)'],
  },
  'pet-shoes-wear-dog-shoes': {
    summary:
      'Protective booties sold as a set of four, for hot pavement, rough ground, salt and ice.',
    confirm: [
      'Paw measurement — paw width and length is what decides fit, and a loose bootie comes off on the first fast walk.',
      'That all four stay on. Introduce them one paw at a time indoors before a real walk.',
      'Surface temperature: booties help, but hot pavement can still burn through a thin sole, so test the ground with your hand first.',
    ],
    care: [
      'Rinse and dry them after wet or salted ground, and check the soles for wear.',
      'Take them off if your dog is limping or the bootie twists — a badly fitted bootie does more harm than none.',
    ],
    needs: ['paw width and length per size', 'sole material', 'closure type', 'whether they are sold as 4 or 2'],
  },
  'retractable-dog-leash-5m-one-button-lock-with-anti-slip-grip': {
    summary:
      'A five-metre retractable lead with a one-button lock and an anti-slip grip, for open walks where letting your dog range further is useful.',
    confirm: [
      'Dog size and pulling habit. A retractable lead keeps constant tension on the line and is a poor match for a strong puller.',
      'Where you will use it: retractable leads are a bad fit near roads, cyclists and other dogs.',
      'Fit of the grip and the lock — check the listing for the size range it is intended for.',
    ],
    care: [
      'Keep the cord away from hands, legs and other pets; a thin cord under tension can cut.',
      'Inspect the cord and the housing regularly and stop using it at the first sign of fraying or a slow brake.',
    ],
    needs: ['weight range', 'cord or tape type and width', 'brake mechanism details'],
  },

  // ------------------------------------------------------------ Feeding & Water
  'ceramic-cat-face-food-bowl-easy-clean-pet-dish': {
    summary:
      'A ceramic food dish shaped for cats, with a shallow profile that keeps whiskers clear of the rim.',
    confirm: [
      'Capacity, so it suits the portion size you feed and does not need refilling mid-meal.',
      'Whether the base is stable on your floor — a light bowl that slides can be pushed across the kitchen.',
      'Microwave and dishwasher suitability, which is not confirmed on this page.',
    ],
    care: [
      'Wash it after wet food rather than leaving residue to dry on.',
      'Check the rim and base for chips; a chipped ceramic edge is sharp.',
    ],
    needs: ['capacity in ml/oz', 'dishwasher and microwave suitability', 'base diameter and weight'],
  },
  'silicone-feeding-placemat-dogs-cats': {
    summary:
      'A square silicone placemat to sit under bowls, so spilled water and food stay off the floor.',
    confirm: [
      'Dimensions, so it actually covers the spill zone under your bowls.',
      'Whether it lies flat on your floor type — mats slide most on smooth tile and laminate.',
      'Colour or pattern options, which are not listed on this page.',
    ],
    care: [
      'Wipe or rinse after each meal; silicone holds odour if food is left on it.',
      'Dry it fully, or lift it periodically, so moisture does not sit trapped under the mat.',
    ],
    needs: ['dimensions', 'silicone thickness', 'available colours', 'heat resistance'],
  },
  'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs': {
    summary:
      'A stainless steel fountain that keeps water moving through a filter, for pets that drink more when the water circulates.',
    confirm: [
      'Capacity, which decides how often you refill it, and the height it needs to sit at.',
      'Filter availability: a fountain is only useful if you can keep replacing the filter.',
      'Noise level and pump placement. This page does not publish a decibel figure, so ask us if the fountain will sit in a bedroom.',
    ],
    care: [
      'Change the water and rinse the bowl regularly; the filter reduces debris but does not keep water fresh on its own.',
      'Clean the pump intake, which is the part that clogs first and then slows the flow.',
    ],
    needs: ['capacity', 'decibel rating with a source', 'filter part number and replacement interval', 'pump wattage'],
  },

  // ------------------------------------------------------------------- Grooming
  'usb-rechargeable-pet-nail-grinder-quiet-motor-for-dogs-cats': {
    summary:
      'A rechargeable rotary nail grinder for dogs and cats, for smoothing nails rather than clipping them.',
    confirm: [
      'Whether your pet accepts the sound and vibration. Introduce it switched off, then running, before it touches a nail.',
      'Which grinder head suits your pet\'s nail size — check the listing for what is included.',
      'How short you intend to grind. Taking small passes and stopping above the quick is safer than removing a lot at once.',
    ],
    care: [
      'Stop at the first sign of a pink or dark spot near the tip — that is the quick, and grinding into it hurts and bleeds.',
      'Clean hair and dust out of the head after each use, and check the head for wear.',
    ],
    needs: ['noise level with a source', 'battery runtime', 'included drum/head sizes', 'speed settings'],
  },

  // ---------------------------------------------------------------------- Horse
  'himalayan-30-lb-trace-mineral-salt-block': {
    summary:
      'A Himalayan salt block that doubles as a salt and trace-mineral lick for horses and livestock. It is shaped to sit out in a paddock or trough rather than to be carried around.',
    confirm: [
      'What your animals actually need. Salt and mineral requirements depend on forage, work level and the animal itself, so this is worth confirming with your vet or feed adviser.',
      'How it will be placed — on the ground, in a holder or in a trough — and whether the animals can reach it safely.',
      'Storage: salt blocks take on moisture, so keep them dry until they go out.',
    ],
    care: [
      'Keep it off wet ground where it will dissolve into mud, and reposition it so its use is spread around the paddock.',
      'Provide clean water at all times alongside any salt lick.',
    ],
    needs: ['exact dimensions and weight verification', 'mineral analysis / guaranteed analysis document', 'whether it is food-grade or feed-grade'],
  },
  'himalayan-round-rope-salt-lick-6-lb-pack-of-4': {
    summary:
      'A pack of rope-mounted salt licks, intended for hanging so horses and livestock can use them at a height rather than off the ground.',
    confirm: [
      'Whether the mineral content suits your animals — confirm with your vet or feed adviser against their forage and workload.',
      'How you will hang them and at what height, so each animal can reach it comfortably.',
      'That four is the right quantity for your number of animals and paddocks.',
    ],
    care: [
      'Hang it clear of walls and fencing so animals do not rub against the hardware.',
      'Check the rope and any fixings regularly, and keep clean water available at all times.',
    ],
    needs: ['mineral analysis document', 'rope material and length', 'exact per-lick weight verification'],
  },
  'horse-fly-mask-with-ears': {
    summary:
      'A breathable mesh fly mask with ear covers, for turnout and ridden work in fly season. It is a physical barrier against flies and sunlight.',
    confirm: [
      'Head size and shape — fit matters more than size label, since a loose mask rubs and a tight one presses.',
      'Whether your horse will tolerate ear covers, which some dislike at first.',
      'What it does and does not do: this page states no measured sun-protection rating, so treat the mask as a physical mesh cover against flies rather than a rated barrier.',
    ],
    care: [
      'Check daily for rubbing behind the ears and along the cheekbones, especially in the first week.',
      'Rinse and air-dry it, and inspect the mesh for tears before turnout so it cannot catch on fencing.',
    ],
    guide: { label: 'Horse fly mask buying guide', href: '/blog/horse-fly-mask-buyers-guide' },
    needs: ['size chart with head measurements', 'UPF rating with a test report', 'mesh material', 'whether a forelock opening is included'],
  },

  // ------------------------------------------------------------ Pet Accessories
  'adjustable-pet-car-seatbelt-tether-2-pack': {
    summary:
      'A two-pack of adjustable vehicle tethers that clip a pet’s body harness to a vehicle seatbelt receptacle, helping keep pets in their seat and reducing driver distraction.',
    confirm: [
      'Attach exclusively to a chest harness, never to a neck collar. A tether on a collar creates severe risk during sudden braking.',
      'Check your vehicle’s seatbelt buckle fitting — seatbelt receptacle shapes vary, so inspect the listing photos against your vehicle.',
      'Understand device limits: this is a travel restraint to reduce driver distraction and prevent pets from roaming the cabin; it is not a crash-tested safety device.',
    ],
    care: [
      'Inspect the clip, buckle tab, and webbing stitching before each trip.',
      'Never leave a pet unattended in a parked car, even tethered.',
    ],
    needs: ['length and adjustment range', 'webbing material', 'clip type and load rating evidence'],
  },
  'bungee-pet-car-seatbelt-leash': {
    summary:
      'An elastic bungee travel tether that clips to a chest harness and a car seatbelt buckle, with shock-absorbing give to reduce driver distraction.',
    confirm: [
      'Harness attachment only: never clip a vehicle restraint to a neck collar.',
      'Tether length: adjust so your pet can comfortably sit or lie down, but cannot reach the driver console or front footwells.',
      'Understand device limits: this is a travel restraint for journeys rather than a crash-tested protective device.',
    ],
    care: [
      'Inspect the elastic buffer and the clips for wear; replace if elasticity degrades or webbing frays.',
      'Unclip the tether when the car is parked so your pet cannot get tangled.',
    ],
    needs: ['unloaded and loaded length', 'elastic material', 'clip type and load rating evidence'],
  },
  'foldable-pet-travel-carrier-backpack': {
    summary:
      'A foldable carrier backpack for cats and small dogs, for vet visits and travel where a pet needs to be carried hands-free.',
    confirm: [
      'The airline\'s current rules. Carrier sizing is set by each airline and changes, so check with yours before you fly — this page makes no approval claim.',
      'Your pet\'s measurements against the carrier\'s internal size, and their weight against how it is carried.',
      'Ventilation and visibility, so you can tell at a glance that your pet is comfortable.',
    ],
    care: [
      'Air it and wipe the interior between trips, and check the straps and zips before carrying a pet in it.',
      'Let your pet spend time in it at home before the first journey.',
    ],
    needs: ['internal dimensions', 'weight limit with evidence', 'airline compatibility documentation', 'fabric and frame material'],
  },
  'bone-charm-pendant-necklace': {
    summary:
      'A pendant necklace with an engraved bone charm. This is jewellery for the dog owner to wear — it is not a collar or an accessory to fit on a dog.',
    confirm: [
      'Chain length, so it sits where you want it.',
      'The engraving: that the wording you want is what the listing offers.',
      'That you are ordering human jewellery — it is not sized or built to be worn by a pet.',
    ],
    care: [
      'Keep it away from water, perfume and cleaning products, which dull engraved metal.',
      'Store it separately so the chain does not tangle or scratch.',
    ],
    needs: ['chain length and material', 'charm dimensions', 'engraving character limit'],
  },
  'nylon-anti-grind-dog-leash-collar': {
    summary:
      'A braided nylon collar and leash set, built as an everyday walking pair for dogs that chew or pull on their lead.',
    confirm: [
      'Collar size at the neck, and the leash length you want for where you walk.',
      'That the set is the right pairing for your dog\'s strength — check the listing for the sizes it covers.',
      'Fit at the neck: two fingers should still slide under the collar.',
    ],
    care: [
      'Inspect the braid and the stitching near the rings and clips, which is where a braided lead wears first.',
      'Wash by hand and dry fully so the webbing does not stay damp.',
    ],
    needs: ['collar size range', 'leash length', 'webbing width', 'hardware material'],
  },
  'dog-poop-bags-biodegradable-waste-bag-rolls': {
    summary:
      'Rolls of pick-up bags for walks, sized to fit a standard dispenser. This is the everyday consumable part of walking a dog, so the practical questions are how many rolls you get through and whether the roll fits the dispenser you already carry.',
    confirm: [
      'How many rolls you need, and whether the roll fits the dispenser you already carry.',
      'Disposal: this page does not state a degradation timeframe and makes no compostability claim. Bag it and bin it — that is what keeps it out of the environment.',
      'Thickness, if you have had bags split on you before; check the listing for what it says.',
    ],
    care: [
      'Store rolls somewhere dry, since damp paper-based packaging is what makes them hard to open.',
      'Keep a roll in each coat and bag so you are never without one.',
    ],
    needs: ['material and certification evidence for any biodegradability claim', 'bag dimensions', 'roll count and thickness'],
  },
  'dual-shoulder-pet-carrier-backpack': {
    summary:
      'A dual-shoulder carrier backpack for carrying a small dog on foot, designed to sit on your back with your pet supported in front of you.',
    confirm: [
      'Your pet\'s weight against how far you plan to carry them, and their dimensions against the carrier opening.',
      'How it sits: a two-shoulder carrier needs the straps adjusted before you load a pet into it.',
      'Ventilation and how much of your pet is visible while you walk.',
    ],
    care: [
      'Wipe the interior and let it dry fully between trips.',
      'Check the straps, zips and seams before each use with a pet inside.',
    ],
    needs: ['internal dimensions', 'weight limit with evidence', 'fabric material', 'strap and frame details'],
  },

  // ------------------------------------------------------------------ Pet Beds
  'cooling-pet-mat-ice-silk-cooling-pad-for-cats-dogs': {
    summary:
      'An ice-silk mat that gives a pet a cooler surface to lie on in warm weather. It is a comfort aid, not a treatment for heat stress.',
    confirm: [
      'Size, so your pet can actually stretch out on it.',
      'That it is a passive surface — if a pet is panting heavily, overheating or unwell, that needs shade, water and a vet, not a mat.',
      'Washability, since these are used against bare skin and fur.',
    ],
    care: [
      'Wash it as often as you would a pet blanket, and dry it fully to keep the fabric cool-feeling.',
      'Bring it indoors after use so it does not bake in direct sun.',
    ],
    needs: ['dimensions', 'fabric composition', 'whether it is machine washable', 'any cooling-mechanism documentation (no gel claims without evidence)'],
  },
  'cozy-cat-nest-bed-round-plush-mat': {
    summary:
      'A round plush nest bed for cats, with raised sides that give a cat something to curl against.',
    confirm: [
      'Diameter against your cat\'s length when stretched out, not curled.',
      'Washability. Nest beds see a lot of hair, so check how the cover is cleaned before you commit.',
      'That the base does not slide on your floor.',
    ],
    care: [
      'Shake it out and wash it regularly to keep hair and dander down.',
      'Check the seams and the filling after washing, and replace it if the filling clumps or the cover tears.',
    ],
    needs: ['diameter and height', 'fabric and filling material', 'removable/washable cover (yes/no)'],
  },
  'cute-cat-blankets-dog-pet-mat': {
    summary:
      'A washable fleece blanket that doubles as a crate or carrier mat, for lining a bed or covering a seat.',
    confirm: [
      'Dimensions, so it covers the crate, seat or bed you have in mind.',
      'Whether your pet chews fabric — a chewed fleece blanket should be taken away rather than left in a crate.',
      'Colour options, which this page does not list.',
    ],
    care: [
      'Wash it on a normal cycle and dry it fully; fleece that stays damp smells.',
      'Take it out of a crate if your pet starts tearing at it, since swallowed fibres are a real risk.',
    ],
    needs: ['dimensions', 'fleece composition', 'available colours', 'care label instructions'],
  },
  'dog-bed': {
    summary:
      'A plush bolster bed for dogs and cats, with a raised edge to lean against. It is an everyday comfort bed rather than a support or therapy product.',
    confirm: [
      'Size against your pet\'s length when stretched out. The listing shows the sizes offered; the measurements themselves are not published on this page.',
      'Washability: check how the cover is cleaned before buying, because beds get soiled.',
      'That the base grips your floor and the bed sits out of draughts.',
    ],
    care: [
      'Wash the cover regularly and dry it fully, so it does not stay damp or clump.',
      'Inspect the seams and filling after each wash, and replace the bed if the filling breaks down or the cover tears.',
    ],
    needs: ['size chart with dimensions', 'cover and filling materials', 'removable/washable cover (yes/no)', 'whether the base is non-slip'],
  },
  'orthopedic-memory-foam-dog-bed': {
    summary:
      'A memory-foam bed sized for larger and older dogs, with a firmer base meant to be easier to get up from than a loose-stuffed bed. It is a comfort bed, not a treatment for joint disease.',
    confirm: [
      'The foam. This page does not state a foam density, thickness or any certification, so if that matters to you, ask us before ordering.',
      'Size for a large dog stretched out, plus room to step on and off it.',
      'For an older dog with mobility problems, positioning the bed on a non-slip surface helps more than the bed alone.',
    ],
    care: [
      'Air the foam rather than soaking it, and wash the cover as the care label allows.',
      'Check for a collapsed or compressed sleeping area; once memory foam loses its shape the bed stops doing its job.',
    ],
    needs: ['foam density, thickness and layer count', 'any CertiPUR-US or similar certification document', 'cover material and washability', 'size chart'],
  },

  // ------------------------------------------------------------------ Pet Toys
  'collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube': {
    summary:
      'A collapsible three-way play tunnel with a crinkle lining and peek hole, for cats that like to hide, stalk and dash.',
    confirm: [
      'Space: a three-way tunnel needs floor room, and it works better with a clear run-up to each opening.',
      'That your cat plays with it supervised at first, so you can see how it reacts to the crinkle lining.',
      'How it folds down, if you plan to put it away between play sessions.',
    ],
    care: [
      'Wipe it down and shake out hair and toys, then check the frame wire for bends or exposed ends.',
      'Take it away if your cat starts chewing the fabric or the wire pokes through.',
    ],
    guide: { label: 'How to choose a cat tunnel', href: '/blog/how-to-choose-a-cat-tunnel' },
    needs: ['dimensions when open and folded', 'fabric and frame materials', 'whether the frame is wire or sprung steel'],
  },
  'silicone-flying-disc-dog-toy': {
    summary:
      'A flexible silicone flying disc for fetch, soft enough to catch and throw indoors or out.',
    confirm: [
      'Whether your dog is a chewer. A disc is a fetch toy; a dog that settles down to destroy it needs a different kind of toy.',
      'Where you will throw it — even a soft disc needs open space.',
      'That your dog can see it against your ground and flooring.',
    ],
    care: [
      'Rinse the silicone and dry it, and check the edges for tears before each use.',
      'Take it away at the first tear or split, since loose silicone is a swallowing risk.',
    ],
    needs: ['diameter', 'silicone hardness/durometer', 'whether it floats', 'temperature tolerance'],
  },
};

/**
 * Facts that only the owner or supplier can supply. These are the fields that
 * would turn each thin product page into a genuinely substantive one — publish
 * them as real catalog `specifications`, not as prose, and never guess them.
 *
 * Priority order is by how many indexed pages each fact would strengthen:
 *   1. Size charts (chest girth for harnesses, neck sizes for collars, internal
 *      dimensions for carriers). Sizing is the top reason these products come
 *      back, and the top question a buyer cannot answer on the page today.
 *   2. Materials, with evidence — webbing, hardware, foam density, mesh, fabric.
 *   3. Care instructions from the manufacturer's label (washable or not).
 *   4. The handful of performance claims that currently have no document behind
 *      them: UV protection on the fly mask, decibel figures on the nail grinder
 *      and water fountain, weights and load ratings on car tethers and carriers,
 *      and biodegradability on the waste bags. Supply a test report or remove
 *      the claim.
 *   5. Salt and mineral products need the guaranteed-analysis document, because
 *      feeding recommendations cannot be written without it.
 */
export const NEEDS_OWNER_EVIDENCE: string[] = [
  'Size charts with real measurements for every wearable (harness, collars, clothing, shoes, carriers, fly mask).',
  'Material and hardware specifications per product, with the supplier document that states them.',
  'Manufacturer care labels (machine washable, dryer safe, hand wash only).',
  'Test reports for: fly mask UV rating, nail grinder and fountain decibel figures, car tether and carrier load ratings, waste bag biodegradability.',
  'Guaranteed analysis / mineral analysis documents for the Himalayan salt block and salt licks.',
  'Foam specification (density, thickness, layers) and any certification for the orthopedic dog bed.',
];

/** Look up buyer content for a product slug. Returns undefined when unknown. */
export function productContentFor(slug: string | null | undefined): ProductContent | undefined {
  if (!slug) return undefined;
  if (!Object.prototype.hasOwnProperty.call(PRODUCT_CONTENT, slug)) return undefined;
  const entry = PRODUCT_CONTENT[slug];
  if (!entry || !entry.summary) return undefined;
  // Same rule as the category lookup: a guide link whose URL is retired (or
  // held) is dropped at the shared lookup rather than advertised and clicked
  // into a dead end. Dropping it here covers both render paths at once.
  if (entry.guide && !isLinkablePublicPath(entry.guide.href)) return { ...entry, guide: undefined };
  return entry;
}
