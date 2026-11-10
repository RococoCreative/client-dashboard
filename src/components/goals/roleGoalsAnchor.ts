// The anchor a role's card carries on Goals > By role, kept out of the panel file so it exports
// only its component (Fast Refresh), and shared with Settings > Roles, which links straight to it.
export function roleGoalsAnchor(roleId: string): string {
  return `role-goals-${roleId}`;
}

export function roleGoalsPath(roleId: string): string {
  return `/goals/roles#${roleGoalsAnchor(roleId)}`;
}
