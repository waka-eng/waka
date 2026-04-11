import {
  createElement,
  type CSSProperties,
  type ReactElement,
} from "react";

import {
  normalizeSharedInspirationOpenGraphImageModel,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
  type SharedInspirationOpenGraphImageModelInput,
} from "./shared-inspiration-open-graph-image.ts";

export interface SharedInspirationOpenGraphImageTemplateProps {
  image?: SharedInspirationOpenGraphImageModelInput | null;
}

const ROOT_STYLE: CSSProperties = {
  alignItems: "stretch",
  background: "linear-gradient(135deg, #1c1917 0%, #0c0a09 58%, #451a03 100%)",
  color: "#fafaf9",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  justifyContent: "space-between",
  padding: "48px",
  width: "100%",
};

const CONTENT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxWidth: "960px",
};

const META_ROW_STYLE: CSSProperties = {
  alignItems: "center",
  display: "flex",
  marginBottom: "28px",
};

const TITLE_STYLE: CSSProperties = {
  display: "flex",
  fontSize: "64px",
  fontWeight: 700,
  letterSpacing: "-0.05em",
  lineHeight: 1.04,
  marginBottom: "20px",
};

const EXCERPT_STYLE: CSSProperties = {
  color: "#d6d3d1",
  display: "flex",
  fontSize: "31px",
  lineHeight: 1.35,
};

const FOOTER_STYLE: CSSProperties = {
  alignItems: "flex-end",
  borderTop: "1px solid rgba(231, 229, 228, 0.12)",
  display: "flex",
  justifyContent: "space-between",
  paddingTop: "26px",
};

const FOOTER_CONTEXT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const FOOTER_LABEL_STYLE: CSSProperties = {
  color: "#fbbf24",
  display: "flex",
  fontSize: "18px",
  letterSpacing: "0.22em",
  marginBottom: "8px",
  textTransform: "uppercase",
};

const FOOTER_VALUE_STYLE: CSSProperties = {
  color: "#a8a29e",
  display: "flex",
  fontSize: "24px",
};

const BRAND_BADGE_STYLE: CSSProperties = {
  border: "1px solid rgba(245, 158, 11, 0.4)",
  borderRadius: "999px",
  color: "#fbbf24",
  display: "flex",
  fontSize: "18px",
  fontWeight: 700,
  letterSpacing: "0.24em",
  marginRight: "14px",
  padding: "10px 18px",
  textTransform: "uppercase",
};

const SOURCE_BADGE_STYLE: CSSProperties = {
  background: "rgba(251, 191, 36, 0.14)",
  border: "1px solid rgba(251, 191, 36, 0.26)",
  borderRadius: "999px",
  color: "#fde68a",
  display: "flex",
  fontSize: "18px",
  fontWeight: 700,
  letterSpacing: "0.18em",
  marginRight: "14px",
  padding: "10px 18px",
  textTransform: "uppercase",
};

const DOMAIN_BADGE_STYLE: CSSProperties = {
  border: "1px solid rgba(231, 229, 228, 0.22)",
  borderRadius: "999px",
  color: "#d6d3d1",
  display: "flex",
  fontSize: "18px",
  padding: "10px 18px",
};

function createBadge(
  label: string,
  style: CSSProperties,
  key: string,
): ReactElement {
  return createElement("div", { key, style }, label);
}

export function SharedInspirationOpenGraphImageTemplate(
  props: SharedInspirationOpenGraphImageTemplateProps = {},
): ReactElement {
  const image = normalizeSharedInspirationOpenGraphImageModel(props.image);
  const badges = [
    createBadge(
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
      BRAND_BADGE_STYLE,
      "brand",
    ),
    createBadge(image.sourceLabelShort, SOURCE_BADGE_STYLE, "source"),
  ];

  if (image.domain !== undefined) {
    badges.push(createBadge(image.domain, DOMAIN_BADGE_STYLE, "domain"));
  }

  return createElement("div", { style: ROOT_STYLE }, [
    createElement("div", { key: "content", style: CONTENT_STYLE }, [
      createElement("div", { key: "meta", style: META_ROW_STYLE }, badges),
      createElement("div", { key: "title", style: TITLE_STYLE }, image.title),
      createElement(
        "div",
        { key: "excerpt", style: EXCERPT_STYLE },
        image.summarySnippet,
      ),
    ]),
    createElement("div", { key: "footer", style: FOOTER_STYLE }, [
      createElement("div", { key: "context", style: FOOTER_CONTEXT_STYLE }, [
          createElement(
            "div",
            { key: "footer-label", style: FOOTER_LABEL_STYLE },
            "Shared note",
          ),
        createElement(
          "div",
          { key: "footer-value", style: FOOTER_VALUE_STYLE },
          image.sourceLabel,
        ),
      ]),
      createElement(
        "div",
        { key: "created", style: FOOTER_VALUE_STYLE },
        image.createdLabel,
      ),
    ]),
  ]);
}
