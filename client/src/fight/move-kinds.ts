// Names of the fight moves a pack may pick. Kept apart from moves.ts (which needs three.js) so the pack tool can
// check pack files under plain Node; moves.ts is type-checked against these lists.
export const ATTACK_KINDS = ['burst', 'snipe', 'pounce', 'charge', 'dive', 'volley', 'twirl', 'breath'] as const;
export const KNOCKOUT_KINDS = ['pratfall', 'spinout', 'launch', 'topple', 'flatten'] as const;

export type AttackKind = (typeof ATTACK_KINDS)[number];
export type KnockoutKind = (typeof KNOCKOUT_KINDS)[number];
