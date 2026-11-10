// Motivierende Saetze fuer die Begruessung nach dem Login und auf der
// Startseite. Zum Ergaenzen einfach einen weiteren Satz in die passende
// Gruppe schreiben (in Anfuehrungszeichen, mit Komma am Ende).
//
// Auswahl (pickSaying): allgemeine Saetze + Saetze zur Funktion der Person
// (Pre-Sales, Werber, Makler) + zur Tageszeit (morgens bis 11 Uhr,
// nachmittags 14-17 Uhr, abends ab 17 Uhr) + zum Wochentag (Montag,
// Freitag). Nie zweimal hintereinander derselbe Satz.

export const SAYINGS = {
  allgemein: [
    "Lass uns starten und Umsatz machen. Der Kaffee ist schon warm. ☕",
    "Bleib dran – der Fleißige gewinnt immer. Und der Zweitfleißigste wenigstens das Kantinen-Duell.",
    "Heute ist ein guter Tag für ein „Ja“. Morgen übrigens auch.",
    "Jedes „Nein“ bringt dich näher ans nächste „Ja“. Statistik ist auf deiner Seite.",
    "Wer anruft, gewinnt. Wer nicht anruft, gewinnt … Zeit zum Nachdenken.",
    "Die Telefonnummern wählen sich leider noch nicht von allein. Aber du bist ja da.",
    "Mittelstand ruft – du gehst ran. Bzw. du rufst an. Du weißt, was gemeint ist.",
    "Der frühe Vogel fängt den Geschäftsführer, bevor das Meeting beginnt.",
    "Ein Termin am Tag hält die Flaute fern.",
    "Lächeln beim Telefonieren hört man. Ausprobieren lohnt sich.",
    "Erfolg ist kein Zufall – meistens ist es eine gut gepflegte Wiedervorlage.",
    "Heute schon jemanden zum Mitglied gemacht? Der Tag ist noch jung.",
    "Steuern sparen ist schön. Kunden glücklich machen noch schöner.",
    "Du bist der Grund, warum der Bund der Steuerzahler wächst. Kein Druck. 😉",
    "Nicht jede Firma wartet auf deinen Anruf – aber die richtige schon.",
    "Ran an die Liste! Die erledigt sich nämlich nicht durch Hinschauen.",
    "Ein gutes Gespräch ist wie ein guter Espresso: kurz, stark, wirkt lange.",
    "Wer Termine sät, wird Abschlüsse ernten.",
    "Heute wird ein Tag für die Statistik. Die schöne Seite der Statistik.",
    "Auf geht's – die Konkurrenz telefoniert auch nicht für dich.",
    "Neuer Tag, neue Firmen, neue Chancen. Die Liste freut sich schon auf dich.",
    "Gute Nachrichten: Heute hat noch niemand Nein gesagt.",
    "Erfahrung schlägt jeden Algorithmus. Zeig's ihnen heute wieder.",
    "Ein Gespräch mehr als gestern – schon ist heute ein guter Tag.",
    "Wer viel fragt, bekommt viele Antworten. Manche davon heißen Termin.",
    "Kleine Schritte, große Wirkung. Und ein Haken mehr in der Liste.",
    "Die beste Zeit für den nächsten Anruf? Jetzt. Die zweitbeste? Gleich danach.",
    "Wer zuhört, verkauft mehr. Ohren auf, Kaffee rechts daneben.",
    "Tour steht, Navi läuft – heute wird Mittelstand besucht.",
    "Jeder Kunde von morgen ist heute noch eine Adresse in dieser Liste.",
  ],
  presales: [
    "Hörer hoch, Stimme an – du bist heute für viele Chefs die erste gute Nachricht.",
    "Zehn Anrufe, ein Termin – und genau dieser eine zählt.",
    "Du öffnest die Türen, die Kollegen gehen hindurch. Teamwork vom Feinsten.",
    "Ein Nein ist oft nur ein Ja, das noch Zeit braucht. Wiedervorlage setzen!",
    "Kaltakquise? Mit dir wird's warm.",
    "Die Liste ist lang, deine Ausdauer länger.",
  ],
  werber: [
    "Bayern zählt auf dich: Heute wächst der Bund der Steuerzahler wieder.",
    "Ein Mitglied mehr heißt eine Stimme mehr gegen Verschwendung.",
    "Der Unternehmer von heute ist das Mitglied von morgen – und vielleicht der Kunde von übermorgen.",
    "Mitgliedsantrag im Gepäck? Dann kann's losgehen.",
    "Termin für den Makler gleich mitnehmen? Doppelt hält besser.",
  ],
  makler: [
    "Aus einem guten Termin wird eine gute Lösung. Du weißt, wie's geht.",
    "Die Kollegen haben die Tür geöffnet – jetzt bist du am Zug.",
    "Vertrauen ist die beste Rendite. Und die zahlt sich bei dir aus.",
    "Gute Beratung erkennt man daran, dass der Kunde wiederkommt.",
    "Heute einen Unternehmer glücklich machen – und seine Mitarbeiter mit der bAV gleich mit.",
  ],
  morgens: ["Guten Morgen! Die besten Gespräche passieren vor dem ersten Meeting des Chefs."],
  nachmittags: ["Zweite Halbzeit – und die wird bekanntlich gewonnen."],
  abends: ["Kurz noch die Ergebnisse eintragen – dann ist der Tag rund."],
  montag: ["Montag – heute wird die Woche entschieden. Fang gut an."],
  freitag: ["Freitag! Wer jetzt noch Termine macht, startet Montag mit Vorsprung."],
};

// Alle Saetze, die zu Person und Zeitpunkt passen.
export function candidateSayings(functions, date) {
  const d = date || new Date();
  const list = [...SAYINGS.allgemein];
  (functions || []).forEach((f) => {
    if (SAYINGS[f]) list.push(...SAYINGS[f]);
  });
  const h = d.getHours();
  if (h < 11) list.push(...SAYINGS.morgens);
  else if (h >= 14 && h < 17) list.push(...SAYINGS.nachmittags);
  else if (h >= 17) list.push(...SAYINGS.abends);
  const wd = d.getDay(); // 0 = Sonntag
  if (wd === 1) list.push(...SAYINGS.montag);
  if (wd === 5) list.push(...SAYINGS.freitag);
  return Array.from(new Set(list));
}

const LAST_KEY = "gbvm-last-saying";

// Zufaelliger passender Satz - nie derselbe wie beim letzten Mal.
export function pickSaying(functions, date) {
  let last = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch (e) {
    /* ohne Speicher eben ohne Gedaechtnis */
  }
  const pool = candidateSayings(functions, date).filter((s) => s !== last);
  const saying = pool[Math.floor(Math.random() * pool.length)];
  try {
    localStorage.setItem(LAST_KEY, saying);
  } catch (e) {
    /* egal */
  }
  return saying;
}
