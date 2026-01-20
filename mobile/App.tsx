import React, { useEffect, useMemo, useState } from "react";
import { Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

type User = { id: number; email: string; name: string; is_admin: number };
type Deck = { id: number; title: string };
type Card = { id: number; question: string; answer: string; image?: string | null };
type DeckWithCards = Deck & { cards: Card[]; progress: Record<string, string>; categories: string[]; ratings: Record<string, "up" | "down" | null> };
type ReportDeck = {
  deckId: number;
  title: string;
  totalCards: number;
  answered: number;
  unanswered: number;
  categories: Record<string, number>;
};

const palette = {
  bg: "#080b12",
  card: "#0f1422",
  border: "#1c2740",
  text: "#e9f1ff",
  muted: "#95a4c5",
  accent: "#58c567",
  accent2: "#79d085",
  again: "#ef4444",
  hard: "#f97316",
  good: "#facc15",
  easy: "#22c55e",
  unanswered: "#4b5563",
};

const API_BASE = Platform.select({ 
  web: "http://localhost:3000", 
  default: "http://192.168.1.6:3000" 
});

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  return res.json();
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tab, active && { borderColor: palette.accent, backgroundColor: "#122033" }]}>
      <Text style={[styles.tabText, active && { color: palette.accent2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={{ color: palette.muted, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function CategoryButtons({
  categories,
  current,
  onSelect,
}: {
  categories: string[];
  current?: string | null;
  onSelect: (cat: string) => void;
}) {
  return (
    <View style={styles.categories}>
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat}
          onPress={() => onSelect(cat)}
          style={[
            styles.categoryBtn,
            current === cat && { borderColor: palette.accent, shadowColor: palette.accent2, shadowOpacity: 0.35, shadowRadius: 12 },
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: "700" }}>{cat}</Text>
          <Text style={{ color: palette.muted, fontSize: 12 }}>Mark as {cat}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ReportBar({ deck }: { deck: ReportDeck }) {
  const total = Math.max(deck.totalCards, 1);
  const segments = [
    { key: "Again", color: palette.again, value: deck.categories?.Again || 0 },
    { key: "Hard", color: palette.hard, value: deck.categories?.Hard || 0 },
    { key: "Good", color: palette.good, value: deck.categories?.Good || 0 },
    { key: "Easy", color: palette.easy, value: deck.categories?.Easy || 0 },
    { key: "Unanswered", color: palette.unanswered, value: deck.unanswered || 0 },
  ];
  return (
    <View style={styles.reportBar}>
      <View style={{ flexDirection: "row", width: "100%" }}>
        {segments.map((seg) => {
          if (!seg.value) return null;
          return <View key={seg.key} style={{ flex: seg.value / total, backgroundColor: seg.color, height: 12 }} />;
        })}
      </View>
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState<"study" | "reports" | "profile">("study");
  const [user, setUser] = useState<User | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deck, setDeck] = useState<DeckWithCards | null>(null);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reports, setReports] = useState<ReportDeck[]>([]);
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [status, setStatus] = useState("");

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (user) loadDecks();
  }, [user]);

  async function loadSession() {
    try {
      const me = await fetchJson<{ user: User }>("/api/me");
      setUser(me.user);
    } catch {
      setUser(null);
    }
  }

  async function login() {
    setStatus("Signing in...");
    try {
      const res = await fetchJson<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: authForm.email.trim(), password: authForm.password }),
      });
      setUser(res.user);
      setStatus("");
    } catch (e: any) {
      setStatus(e.message || "Login failed");
    }
  }

  async function register() {
    setStatus("Creating account...");
    try {
      const res = await fetchJson<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: authForm.email.trim(), password: authForm.password, name: authForm.name.trim() }),
      });
      setUser(res.user);
      setStatus("");
    } catch (e: any) {
      setStatus(e.message || "Register failed");
    }
  }

  async function logout() {
    await fetchJson("/api/auth/logout", { method: "POST" });
    setUser(null);
    setDeck(null);
    setDecks([]);
  }

  function extractNumericPrefix(title: string): number {
    // Extract numeric prefix from title (e.g., "01-Lesson" -> 1, "10-Lesson" -> 10, "14A-Lesson" -> 14)
    const match = title.match(/^0?(\d+)/);
    return match ? parseInt(match[1], 10) : 9999; // Put non-numeric titles at the end
  }

  function extractSuffix(title: string): string {
    // Extract suffix after number (e.g., "14A-Lesson" -> "A", "14-Lesson" -> "")
    const match = title.match(/^0?\d+([A-Za-z])/);
    return match ? match[1].toUpperCase() : "";
  }

  function compareDeckTitles(a: { title: string }, b: { title: string }): number {
    const numA = extractNumericPrefix(a.title);
    const numB = extractNumericPrefix(b.title);
    if (numA !== numB) {
      return numA - numB;
    }
    // If numbers are equal, sort by suffix (empty suffix comes before letters)
    const suffixA = extractSuffix(a.title);
    const suffixB = extractSuffix(b.title);
    if (!suffixA && !suffixB) return 0;
    if (!suffixA) return -1; // No suffix comes before suffix
    if (!suffixB) return 1;  // Suffix comes after no suffix
    return suffixA.localeCompare(suffixB);
  }

  async function loadDecks() {
    const res = await fetchJson<{ decks: Deck[] }>("/api/decks");
    const sortedDecks = [...res.decks].sort(compareDeckTitles);
    setDecks(sortedDecks);
    if (sortedDecks[0]) {
      loadDeck(sortedDecks[0].id);
    }
  }

  async function loadDeck(deckId: number) {
    setStatus("Loading deck...");
    try {
      const data = await fetchJson<DeckWithCards>(`/api/decks/${deckId}`);
      setDeck(data);
      setIndex(0);
      setShowAnswer(false);
      setStatus("");
    } catch (e: any) {
      setStatus(e.message || "Unable to load deck");
    }
  }

  function move(step: number) {
    if (!deck?.cards.length) return;
    const next = (index + step + deck.cards.length) % deck.cards.length;
    setIndex(next);
    setShowAnswer(false);
  }

  async function selectCategory(cat: string) {
    if (!deck) return;
    const card = deck.cards[index];
    const progress = { ...deck.progress, [String(card.id)]: cat };
    setDeck({ ...deck, progress });
    await fetchJson(`/api/decks/${deck.id}/progress`, {
      method: "POST",
      body: JSON.stringify({ cardId: card.id, category: cat }),
    });
    move(1);
  }

  async function rate(choice: "up" | "down") {
    if (!deck) return;
    const card = deck.cards[index];
    const ratings = { ...deck.ratings, [String(card.id)]: deck.ratings[String(card.id)] === choice ? null : choice };
    setDeck({ ...deck, ratings });
    await fetchJson(`/api/decks/${deck.id}/rating`, {
      method: "POST",
      body: JSON.stringify({ cardId: card.id, rating: ratings[String(card.id)] }),
    });
  }

  async function loadReports() {
    const res = await fetchJson<{ decks: ReportDeck[] }>("/api/reports/progress");
    setReports(res.decks || []);
  }

  async function scheduleReminder() {
    const { status: current } = await Notifications.getPermissionsAsync();
    let final = current;
    if (current !== "granted") {
      const ask = await Notifications.requestPermissionsAsync();
      final = ask.status;
    }
    if (final !== "granted") {
      setStatus("Notification permission denied");
      return;
    }
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: { title: "Study time", body: "Jump back into Paramedic Prep for a quick session." },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 9,
        minute: 0,
      },
    });
    setStatus("Daily reminder set for 9:00");
  }

  const currentCard = deck?.cards[index];
  const currentMark = currentCard ? deck?.progress[String(currentCard.id)] : null;
  const answered = deck ? Object.keys(deck.progress).length : 0;

  const reportsSorted = useMemo(() => {
    return [...reports].sort(compareDeckTitles);
  }, [reports]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.brand}>Paramedic Prep</Text>
        <View style={{ flexDirection: "row" }}>
          <TabButton label="Study" active={tab === "study"} onPress={() => setTab("study")} />
          <TabButton
            label="Reports"
            active={tab === "reports"}
            onPress={() => {
              setTab("reports");
              loadReports().catch(() => null);
            }}
          />
          <TabButton label="Profile" active={tab === "profile"} onPress={() => setTab("profile")} />
        </View>
      </View>

      {!user ? (
        <ScrollView contentContainerStyle={styles.card}>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.muted}>Sign in to sync your decks and progress.</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={authForm.email}
            onChangeText={(email) => setAuthForm({ ...authForm, email })}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={palette.muted}
            secureTextEntry
            value={authForm.password}
            onChangeText={(password) => setAuthForm({ ...authForm, password })}
          />
          <TextInput
            style={styles.input}
            placeholder="Name (for sign up)"
            placeholderTextColor={palette.muted}
            value={authForm.name}
            onChangeText={(name) => setAuthForm({ ...authForm, name })}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity 
              style={styles.btn} 
              onPress={login}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Login"
            >
              <Text style={styles.btnText}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.btn, styles.btnPrimary]} 
              onPress={register}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Sign up"
            >
              <Text style={[styles.btnText, { color: "#0b0f1d" }]}>Sign up</Text>
            </TouchableOpacity>
          </View>
          {!!status && <Text style={styles.muted}>{status}</Text>}
        </ScrollView>
      ) : (
        <>
          {tab === "study" && (
            <ScrollView contentContainerStyle={styles.card}>
              <Text style={styles.title}>Study</Text>
              <Text style={styles.muted}>{deck ? `${answered} / ${deck.cards.length} answered` : "Pick a deck"}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
                {decks.map((d) => (
                  <TouchableOpacity key={d.id} onPress={() => loadDeck(d.id)} style={[styles.pill, deck?.id === d.id && { borderColor: palette.accent }]}>
                    <Text style={{ color: palette.text }}>{d.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {deck && currentCard ? (
                <>
                  <View style={styles.questionCard}>
                    <Text style={styles.question}>{currentCard.question}</Text>
                    <Pill text={currentMark ? `Marked: ${currentMark}` : "Unanswered"} />
                  </View>
                  <View style={styles.answerCard}>
                    <Text style={styles.eyebrow}>Answer</Text>
                    <Text style={styles.answer}>{showAnswer ? currentCard.answer : "Tap reveal to view the answer."}</Text>
                  </View>
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.btn} onPress={() => setShowAnswer(true)}>
                      <Text style={styles.btnText}>Reveal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btn} onPress={() => rate("up")}>
                      <Text style={styles.btnText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btn} onPress={() => rate("down")}>
                      <Text style={styles.btnText}>👎</Text>
                    </TouchableOpacity>
                  </View>
                  <CategoryButtons categories={deck.categories} current={currentMark} onSelect={selectCategory} />
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.btnGhost} onPress={() => move(-1)}>
                      <Text style={styles.btnText}>Previous</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => move(1)}>
                      <Text style={[styles.btnText, { color: "#0b0f1d" }]}>Next</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={styles.muted}>No deck loaded.</Text>
              )}
            </ScrollView>
          )}

          {tab === "reports" && (
            <ScrollView contentContainerStyle={styles.card}>
              <Text style={styles.title}>Reports</Text>
              <Text style={styles.muted}>Tap refresh if you don’t see latest answers.</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.btn} onPress={loadReports}>
                  <Text style={styles.btnText}>Refresh</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={scheduleReminder}>
                  <Text style={styles.btnText}>Set daily reminder</Text>
                </TouchableOpacity>
              </View>
              {reportsSorted.map((d) => {
                const pct = d.totalCards ? Math.round((d.answered / d.totalCards) * 100) : 0;
                return (
                  <View key={d.deckId} style={styles.reportItem}>
                    <View style={styles.reportRow}>
                      <View>
                        <Text style={styles.eyebrow}>Lesson</Text>
                        <Text style={styles.titleSm}>{d.title}</Text>
                      </View>
                      <Pill text={`${d.answered}/${d.totalCards} answered`} />
                    </View>
                    <ReportBar deck={d} />
                    <Text style={styles.muted}>
                      {pct}% complete · {d.unanswered} unanswered
                    </Text>
                  </View>
                );
              })}
              {!reportsSorted.length && <Text style={styles.muted}>No activity yet.</Text>}
              {!!status && <Text style={styles.muted}>{status}</Text>}
            </ScrollView>
          )}

          {tab === "profile" && (
            <ScrollView contentContainerStyle={styles.card}>
              <Text style={styles.title}>Profile</Text>
              <Text style={styles.titleSm}>{user.name}</Text>
              <Text style={styles.muted}>{user.email}</Text>
              {user.is_admin ? <Pill text="Admin" /> : <Pill text="Learner" />}
              <TouchableOpacity style={styles.btnGhost} onPress={logout}>
                <Text style={styles.btnText}>Logout</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, paddingTop: Platform.OS === "android" ? 38 : 0 },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { color: palette.text, fontWeight: "800", fontSize: 18 },
  card: { padding: 16, gap: 12 },
  title: { color: palette.text, fontSize: 20, fontWeight: "700" },
  titleSm: { color: palette.text, fontSize: 16, fontWeight: "700" },
  muted: { color: palette.muted },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    borderRadius: 12,
    padding: 12,
    color: palette.text,
  },
  btn: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  btnPrimary: { backgroundColor: palette.accent, borderColor: "transparent" },
  btnText: { color: palette.text, fontWeight: "700" },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    marginLeft: 8,
  },
  tabText: { color: palette.muted, fontWeight: "700" },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    marginRight: 8,
  },
  questionCard: { padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: palette.card, gap: 6 },
  answerCard: { padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: "#0c1324", gap: 6 },
  question: { color: palette.text, fontSize: 18, fontWeight: "700" },
  answer: { color: palette.text, fontSize: 16 },
  row: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 6 },
  categories: { gap: 10 },
  categoryBtn: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "#0f1a30",
    borderRadius: 12,
    padding: 12,
    shadowColor: "black",
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  eyebrow: { textTransform: "uppercase", letterSpacing: 0.08, color: palette.muted, fontWeight: "700", fontSize: 12 },
  reportItem: { borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 12, gap: 8, backgroundColor: palette.card },
  reportRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reportBar: { borderWidth: 1, borderColor: palette.border, borderRadius: 999, overflow: "hidden", backgroundColor: "#0b1222" },
});
