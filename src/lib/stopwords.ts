// Stopwords for vernacular analysis: function words that say nothing about a topic. Short, conservative
// lists (pronouns, articles, prepositions, auxiliaries, conjunctions) so content words are never dropped.

const STOPWORDS: Record<string, string> = {
  en: `a about above after again against all am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further had has have having
    he her here hers herself him himself his how i if in into is it its itself just me more most my myself no
    nor not now of off on once only or other our ours ourselves out over own same she should so some such than
    that the their theirs them themselves then there these they this those through to too under until up very
    was we were what when where which while who whom why will with would you your yours yourself yourselves
    s t don doesn didn isn aren wasn weren won ll ve re d m o y also get got via vs`,
  de: `aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes auch auf
    aus bei bin bis bist da damit dann das dass dein deine dem den der des dich die dies diese diesem diesen
    dieser dieses dir doch dort du durch ein eine einem einen einer eines er es euer eure für gegen hab habe
    haben hat hatte hier hin hinter ich ihr ihre im in ist ja jede jedem jeden jeder jedes jetzt kann kein
    keine man mein meine mich mir mit muss nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich
    sie sind so über um und uns unser unter vom von vor war waren was weg weil wenn wer wie wieder will wir
    wird zu zum zur zwischen`,
  nl: `aan al alles als altijd andere ben bij daar dan dat de der deze die dit doch doen door dus een eens en
    er ge geen geweest haar had heb hebben heeft hem het hier hij hoe hun iemand iets ik in is ja je kan kon
    kunnen maar me meer men met mij mijn moet na naar niet niets nog nu of om omdat onder ons ook op over reeds
    te tegen toch toen tot u uit uw van veel voor want waren was wat werd wezen wie wil worden wordt zal ze
    zelf zich zij zijn zo zonder zou`,
  fr: `ai au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me même mes moi
    mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre
    vous c d j l à m n s t y été être avoir est sont fait plus comme tout tous cette cet`,
  es: `a al algo algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos
    en entre era es esa esas ese eso esos esta estas este esto estos fue ha hasta hay la las le les lo los más
    me mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque que quien se sea ser
    si sin sobre su sus también te tiene todo todos tu tus un una uno unos y ya yo`,
  pt: `a ao aos as até com como da das de dela dele deles depois do dos e ela elas ele eles em entre era essa
    esse esta este eu foi há isso isto já lhe mais mas me mesmo meu minha muito na nas não nem no nos nós o os
    ou para pela pelo por qual quando que quem se sem ser seu seus sua suas também te tem um uma você`,
  it: `a ad al alla alle anche ai che chi ci come con da dal dalla dei del della delle di e è ed gli ha hanno
    il in io la le lei lo loro lui ma mi mio ne nel nella noi non o per più quale quando questa questo se si
    sono su sua suo tra tu un una uno voi`,
};

const parsed = new Map<string, Set<string>>();

/** Stopwords for a base language code; empty for languages without a list. */
export function stopwordsFor(language: string): Set<string> {
  const code = language.toLowerCase();
  let words = parsed.get(code);
  if (!words) {
    words = new Set((STOPWORDS[code] ?? '').split(/\s+/).filter(Boolean));
    parsed.set(code, words);
  }
  return words;
}

export const STOPWORD_LANGUAGES = Object.keys(STOPWORDS);

/**
 * One stopword set for a dataset: English (titles mix in English even in other languages), every listed
 * language that makes up at least 5% of videos, and the project's own exclusions.
 */
export function buildStopwordSet(languageShares: Array<{ code: string; share: number }>, exclusions: string[] = []): { words: Set<string>; languages: string[] } {
  const languages = ['en', ...languageShares.filter((entry) => entry.share >= 0.05 && entry.code !== 'en' && STOPWORDS[entry.code]).map((entry) => entry.code)];
  const words = new Set<string>();
  languages.forEach((code) => stopwordsFor(code).forEach((word) => words.add(word)));
  exclusions.forEach((term) => {
    const normalized = term.trim().toLowerCase().replace(/^#/, '');
    if (normalized) words.add(normalized);
  });
  return { words, languages };
}
