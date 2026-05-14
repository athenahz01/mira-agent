import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { MediaKitJson } from "@/lib/db/media-kit";

type MediaKitDocumentProps = {
  kit: MediaKitJson;
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    color: "#18181b",
    backgroundColor: "#fff",
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#71717a",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: "#52525b",
    lineHeight: 1.5,
  },
  section: {
    marginTop: 22,
    paddingTop: 14,
    borderTop: "1 solid #e4e4e7",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flexGrow: 1,
    padding: 12,
    backgroundColor: "#f4f4f5",
    borderRadius: 6,
  },
  statLabel: {
    fontSize: 9,
    color: "#71717a",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 700,
  },
  text: {
    fontSize: 10,
    color: "#3f3f46",
    lineHeight: 1.5,
  },
  item: {
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 3,
  },
});

export function MediaKitDocument({ kit }: MediaKitDocumentProps) {
  const pastBrandWork = kit.past_brand_work.filter(Boolean);

  return (
    <Document title={`${kit.profile_summary.display_name} Media Kit`}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.eyebrow}>Media Kit</Text>
        <Text style={styles.title}>{kit.profile_summary.display_name}</Text>
        <Text style={styles.subtitle}>{kit.profile_summary.tagline}</Text>
        <Text style={styles.subtitle}>
          {kit.profile_summary.location} | {kit.profile_summary.languages.join(", ")}
        </Text>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Platform</Text>
              <Text style={styles.statValue}>{kit.audience.platform}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Followers</Text>
              <Text style={styles.statValue}>
                {kit.audience.follower_count.toLocaleString()}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Engagement</Text>
              <Text style={styles.statValue}>
                {(kit.audience.engagement_rate * 100).toFixed(1)}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Content Pillars</Text>
          <Text style={styles.text}>{kit.niche.content_pillars.join(" | ")}</Text>
          <Text style={styles.text}>
            {kit.niche.categories.join(", ")} |{" "}
            {kit.niche.aesthetic_keywords.join(", ")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Deliverables</Text>
          {kit.deliverables.map((deliverable) => (
            <View key={deliverable.kind} style={styles.item}>
              <Text style={styles.itemTitle}>
                {formatKind(deliverable.kind)} | $
                {deliverable.suggested_rate_usd.min.toLocaleString()}-$
                {deliverable.suggested_rate_usd.max.toLocaleString()}
              </Text>
              <Text style={styles.text}>{deliverable.description}</Text>
              <Text style={styles.text}>
                {deliverable.usage_rights_included} |{" "}
                {deliverable.typical_turnaround_days} day turnaround
              </Text>
            </View>
          ))}
        </View>

        {pastBrandWork.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Past Brand Work</Text>
            {pastBrandWork.map((work) => (
              <View key={`${work.brand_name}-${work.year}`} style={styles.item}>
                <Text style={styles.itemTitle}>
                  {work.brand_name} | {work.year}
                </Text>
                <Text style={styles.text}>{work.one_liner}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <Text style={styles.text}>{kit.contact.email}</Text>
          <Link src={kit.contact.instagram} style={styles.text}>
            {kit.contact.instagram}
          </Link>
          {kit.contact.website ? (
            <Link src={kit.contact.website} style={styles.text}>
              {kit.contact.website}
            </Link>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.text}>{kit.rate_methodology_note}</Text>
        </View>
      </Page>
    </Document>
  );
}

function formatKind(kind: string) {
  return kind
    .split("_")
    .map((part) => part.toUpperCase())
    .join(" ");
}
