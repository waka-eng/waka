import type { Metadata } from "next";

import { loadSharedInspirationPageMetadata } from "../../../src/sharing/shared-inspiration-page-metadata.ts";

import {
  SharedInspirationPublicPage,
  type SharedInspirationRouteParams,
} from "./shared-inspiration-page.tsx";

export const dynamic = "force-dynamic";

interface SharedInspirationPageRouteProps {
  params: Promise<SharedInspirationRouteParams>;
}

export default function SharedInspirationPageRoute(
  props: SharedInspirationPageRouteProps,
) {
  return SharedInspirationPublicPage(props);
}

export async function generateMetadata(
  props: SharedInspirationPageRouteProps,
): Promise<Metadata> {
  const { slug } = await props.params;

  return loadSharedInspirationPageMetadata(slug);
}
