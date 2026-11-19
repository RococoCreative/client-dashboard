// The anchor a role's card carries on People > Roles, kept out of the panel file so it exports
// only its component (Fast Refresh), and shared with the screens that link straight to it.
export function roleGoalsAnchor(roleId: string): string {
  return `role-goals-${roleId}`;
}

export function roleGoalsPath(roleId: string): string {
  return `/people/roles#${roleGoalsAnchor(roleId)}`;
}
