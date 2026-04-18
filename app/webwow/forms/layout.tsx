/**
 * Forms Layout
 *
 * This layout is used by Next.js for forms routes, but the actual
 * rendering is handled by WebwowBuilder which provides the HeaderBar.
 * This layout just passes through children.
 */
export default function FormsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // WebwowBuilder handles all rendering including HeaderBar
  // This layout just passes through children
  return <>{children}</>;
}
