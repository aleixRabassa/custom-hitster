/**
 * The Catalan catalogue (central Catalan, informal "tu"): every key of `COPY` in `copy.ts`.
 *
 * Typed `satisfies Copy`, so a key added to the English catalogue and forgotten here fails the
 * typecheck. The app name, the footer and the file-name prefixes are reused from `COPY`, never
 * restated; every function keeps English's parameter list and owns its own pluralisation.
 */
import { COPY, type Copy } from './copy';
import { CARDS_PER_SHEET } from './pdf-sheet';

/**
 * "de X", elided to "d'X" before a vowel or an h + vowel, as Catalan spells it before a name.
 * Only used in front of a playlist name, which is free text from Spotify.
 */
const deName = (name: string) => (/^h?[aeiouàèéíïòóúü]/i.test(name) ? `d'${name}` : `de ${name}`);

export const COPY_CA = {
  app: COPY.app,

  welcome: {
    logoAlt: COPY.welcome.logoAlt,
    tagline: 'El joc de cronologia musical, ara amb les teves playlists de Spotify.',
    enter: 'Comença a jugar',
    howItWorksHeading: 'Com funciona',
    steps: {
      pick: {
        title: 'Tria les teves playlists',
        body: (maxPlaylists: number) =>
          `Enganxa fins a ${maxPlaylists} playlists de Spotify, o tria'n de les suggerides. Les cançons es barregen en una sola baralla.`,
      },
      play: {
        title: 'Fes sonar la carta',
        body: 'Prem play per escoltar-ne un fragment, o escaneja el codi QR per escoltar-la sencera a Spotify.',
      },
      guess: {
        title: "Endevina l'any",
        body: "Endevina l'any i toca la carta per descobrir la resposta. Llisca a la dreta per passar a la següent, o a l'esquerra per tornar a l'anterior.",
      },
    },
    printHeading: 'Prefereixes el paper?',
    printCards: 'Imprimeix les cartes',
    printDetail:
      'Descarrega un pdf imprimible amb cartes desde 1970. Imprimeix-lo, retalla les cartes i juga físicament.',
    yearCardsFileName: COPY.welcome.yearCardsFileName,
  },

  landing: {
    logoAlt: COPY.landing.logoAlt,
    intro: (maxPlaylists: number) =>
      `Enganxa o tria fins a ${maxPlaylists} playlists de Spotify per repartir una baralla i començar a jugar.`,
    playlistLinkLabel: (index: number) =>
      index === 0 ? 'Enllaç de la playlist' : `Enllaç de la playlist ${index + 1}`,
    playlistLinkPlaceholder: COPY.landing.playlistLinkPlaceholder,
    removeRow: (position: number) => `Treu la playlist ${position}`,
    addRow: 'Afegeix una altra playlist',
    atMaxRows: (maxPlaylists: number) => `El màxim és de ${maxPlaylists} playlists per baralla.`,
    start: 'Comença',
    starting: 'Carregant…',
    backToWelcome: 'Enrere',
    savedHeading: 'Les teves playlists',
    removeSaved: (name: string) => `Treu ${name} de les teves playlists`,
    suggestionsHeading: "O prova'n una d'aquestes",
    suggestionBlurbs: {
      mixedHits: 'Èxits variats',
      argentineTrap: 'Trap argentí',
      catalanHits: 'Èxits en català',
      catalanAnimeOpenings: "Openings d'anime català",
      disney: 'Bandes sonores Disney',
      filmScores: 'BSO de cine i sèries',
      edm: 'EDM',
      rock: 'Rock',
      reggaeton: 'Reggaeton',
      latinElectro: 'Electrònica llatina',
      globalChart: 'Rànquing mundial',
      spanishHits: "Èxits d'Espanya",
      hipHop: 'Hip-hop',
    },
  },

  language: {
    label: "Tria l'idioma",
  },

  preparing: {
    heading: 'Repartint la baralla…',
    detail:
      'La partida comença tan bon punt la primera carta és a punt — la resta es completen mentre jugues.',
  },

  game: {
    scanCaption: 'Escaneja per escoltar la cançó sencera',
  },

  hud: {
    cardsLeft: (count: number) => (count === 1 ? 'Queda 1 carta' : `Queden ${count} cartes`),
  },

  controls: {
    exit: 'Surt de la partida',
    play: 'Reprodueix',
    pause: 'Pausa',
    keepDeck: 'Guarda aquesta baralla',
    noPreview: 'No hi ha fragment disponible — escaneja per escoltar la cançó',
  },

  card: {
    yearPending: "Encara s'està buscant l'any…",
    yearUnknown: 'Any desconegut',
    yearUnknownDetail: 'Comprova-ho pel teu compte',
    yearUnconfirmed: 'Any sense confirmar',
  },

  qr: {
    alt: 'Escaneja per reproduir a Spotify',
  },

  notice: {
    truncated: (maxTracks: number) =>
      `Pot ser que una playlist tingui més cançons de les que es mostren — només se n'han pogut carregar les primeres ${maxTracks}.`,
    skippedTracks: (count: number) =>
      count === 1
        ? "No s'ha pogut llegir 1 cançó i s'ha deixat fora."
        : `No s'han pogut llegir ${count} cançons i s'han deixat fora.`,
    failedPlaylists: (count: number) =>
      count === 1
        ? "No s'ha pogut carregar 1 playlist i s'ha deixat fora."
        : `No s'han pogut carregar ${count} playlists i s'han deixat fora.`,
    combinedDeck: (deckSize: number, playlistCount: number) =>
      `${deckSize === 1 ? '1 carta' : `${deckSize} cartes`} de ${playlistCount} playlists, barrejades en una sola baralla.`,
    yearsUnavailable:
      'Els anys no estan disponibles en aquest desplegament, així que les cartes no en mostraran cap. La baralla es pot jugar igualment — escaneja una carta per escoltar la cançó.',
    startCardMissing:
      'La carta des de la qual es va compartir aquest enllaç ja no és a la playlist, així que la baralla comença des del principi.',
    dismiss: "Tanca l'avís",
  },

  end: {
    heading: 'Baralla acabada',
    cardsPlayed: (count: number, playlistName: string) =>
      `${count === 1 ? '1 carta jugada' : `${count} cartes jugades`} ${deName(playlistName)}`,
    restart: 'Torna a jugar',
    restartDetail: 'Les mateixes cançons, en un altre ordre',
    home: 'Inici',
    keepDeckHeading: 'Guarda aquesta baralla',
  },

  deckActions: {
    copyLink: "Copia l'enllaç per compartir",
    /** Same playlist(s), same shuffle -- never "the same deck". See the English original. */
    shareCaption: (playlistCount: number, fromCurrentCard: boolean) =>
      `Comparteix la partida. ${playlistCount === 1 ? 'La mateixa playlist' : 'Les mateixes playlists'}, la mateixa barreja${fromCurrentCard ? ', des de la carta on ets' : ''}`,
    save: 'Desa aquesta playlist',
    saved: 'Desada a les teves playlists',
    print: 'Imprimeix les cartes en PDF',
    printing: (completed: number, total: number) => `Generant el PDF… ${completed}/${total}`,
    sheetSummary: (sheets: number) =>
      `${sheets === 1 ? '1 full A4' : `${sheets} fulls A4`}, ${CARDS_PER_SHEET} cartes per full — imprimeix a doble cara`,
    printWaitsForYears: (pendingCount: number) =>
      pendingCount === 1
        ? "1 carta encara està buscant l'any — la impressió espera que acabi"
        : `${pendingCount} cartes encara estan buscant l'any — la impressió espera que acabin totes`,
    waitingHeading: 'Esperant els últims anys…',
    waitingDetail: (pendingCount: number) =>
      pendingCount === 1
        ? "1 carta encara està buscant l'any."
        : `${pendingCount} cartes encara estan buscant l'any.`,
    printPartial: 'Imprimeix el que hi ha',
    cancel: 'Cancel·la',
    exportDone: 'PDF descarregat',
    exportDonePartial: (excludedCount: number) =>
      `PDF descarregat — ${excludedCount === 1 ? "1 carta s'ha quedat fora" : `${excludedCount} cartes s'han quedat fora`}, encara sense any`,
    exportEmpty: 'Cap carta té any encara, així que no hi ha res per imprimir',
    exportFailed: "No s'ha pogut generar el PDF",
    linkCopied: 'Enllaç copiat',
    linkCopyFailed: "No s'ha pogut copiar automàticament — aquí tens l'enllaç",
    shareLinkFieldLabel: 'Enllaç per compartir',
  },

  deckActionsDialog: {
    title: 'Guarda aquesta baralla',
    close: 'Torna a la partida',
  },

  replaceSession: {
    heading: 'Tens una partida en curs',
    body: "Aquest enllaç és d'una altra baralla. Si la jugues, substituirà la partida desada tan bon punt es reparteixi la nova baralla.",
    keep: 'Continua amb la meva partida',
    replace: 'Juga la baralla compartida',
    replacing: 'Carregant la baralla compartida…',
    retry: 'Torna a provar la baralla compartida',
    savedGameIntact: 'La partida desada continua intacta.',
  },

  exitDialog: {
    title: 'Vols acabar la partida?',
    body: "Acaba la partida i torna a la pantalla d'inici, o reinicia-la amb les mateixes cançons en un altre ordre.",
    cancel: 'Continua jugant',
    restart: 'Reinicia la partida',
    confirm: 'Acaba la partida',
  },

  errorBoundary: {
    heading: 'Alguna cosa ha anat malament',
    body: "El joc ha trobat un problema inesperat i s'ha hagut d'aturar. Normalment es resol tornant a carregar la pàgina. Els detalls s'han escrit a la consola del navegador.",
    reload: 'Torna a carregar',
    startOver: 'Torna a començar',
    startOverDetail:
      'Primer esborra la partida desada. Fes-ho servir si tornar a carregar continua fallant — es perdrà qualsevol partida en curs.',
  },

  footer: COPY.footer,

  deck: {
    nameEllipsis: COPY.deck.nameEllipsis,
    label: (truncatedName: string, others: number) =>
      others === 0
        ? truncatedName
        : `${truncatedName} +${others} ${others === 1 ? 'playlist' : 'playlists'}`,
  },

  pdf: COPY.pdf,
} satisfies Copy;
