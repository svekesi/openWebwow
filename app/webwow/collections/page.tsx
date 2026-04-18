'use client';

import WebwowBuilder from '../components/WebwowBuilderMain';

/**
 * Base route for collections view
 * URL: /webwow/collections
 *
 * This route renders the same WebwowBuilder component.
 * Shows all collections or empty state when no collections exist.
 */
export default function CollectionsRoute() {
  return <WebwowBuilder />;
}
