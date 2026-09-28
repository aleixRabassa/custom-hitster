/**
 * The Spanish (Spain, informal "tú") copy catalogue.
 *
 * Typed `satisfies Copy`, so a key added to `COPY` in `copy.ts` and forgotten here fails the
 * typecheck. The app name, the footer and the file names are reused from English, not restated.
 */
import { COPY, type Copy } from './copy';
import { CARDS_PER_SHEET } from './pdf-sheet';

export const COPY_ES = {
  app: COPY.app,

  welcome: {
    logoAlt: COPY.welcome.logoAlt,
    tagline: 'El juego de la línea del tiempo musical, ahora con tus propias playlists de Spotify.',
    enter: 'Empezar a jugar',
    howItWorksHeading: 'Cómo se juega',
    steps: {
      pick: {
        title: 'Elige tus playlists',
        body: (maxPlaylists: number) =>
          `Pega hasta ${maxPlaylists} enlaces de playlists públicas de Spotify, o empieza con una de las sugerencias. Las canciones se barajan en un solo mazo.`,
      },
      play: {
        title: 'Juega la carta',
        body: 'Pulsa Reproducir para escuchar un fragmento, o escanea el código QR de la carta para abrir la canción completa en Spotify.',
      },
      guess: {
        title: 'Adivina el año',
        body: 'Di cuándo salió y luego toca la carta para darle la vuelta y ver la respuesta. Desliza a la derecha para sacar la siguiente carta, o a la izquierda para volver a la anterior.',
      },
    },
    printHeading: '¿Prefieres papel?',
    printCards: 'Imprime tus cartas',
    printDetail:
      'Un PDF imprimible con cartas de años desde 1970. Imprímelo, recórtalas y monta la línea del tiempo sobre la mesa.',
    yearCardsFileName: COPY.welcome.yearCardsFileName,
  },

  landing: {
    logoAlt: COPY.landing.logoAlt,
    intro: (maxPlaylists: number) =>
      `Pega o elige hasta ${maxPlaylists} playlists de Spotify para repartir un mazo y empezar a jugar.`,
    playlistLinkLabel: (index: number) =>
      index === 0 ? 'Enlace de playlist' : `Enlace de playlist ${index + 1}`,
    playlistLinkPlaceholder: COPY.landing.playlistLinkPlaceholder,
    removeRow: (position: number) => `Quitar playlist ${position}`,
    addRow: 'Añadir otra playlist',
    atMaxRows: (maxPlaylists: number) => `El máximo son ${maxPlaylists} playlists por mazo.`,
    start: 'Empezar',
    starting: 'Cargando…',
    backToWelcome: 'Volver',
    savedHeading: 'Tus playlists',
    removeSaved: (name: string) => `Quitar ${name} de tus playlists`,
    suggestionsHeading: 'O prueba una de estas',
    suggestionBlurbs: {
      mixedHits: 'Éxitos variados',
      argentineTrap: 'Trap argentino',
      catalanHits: 'Éxitos en catalán',
      catalanAnimeOpenings: 'Openings de anime en catalán',
      disney: 'Bandas sonoras de Disney',
      filmScores: 'Bandas sonoras de cine y series',
      edm: 'EDM',
      rock: 'Rock',
      reggaeton: 'Reggaeton',
      latinElectro: 'Electro latino',
      globalChart: 'Top mundial',
      spanishHits: 'Éxitos en español',
      hipHop: 'Hip-hop',
    },
  },

  language: {
    label: 'Idioma',
  },

  preparing: {
    heading: 'Repartiendo tu mazo…',
    detail:
      'La partida empieza en cuanto la primera carta esté lista — el resto se completa mientras juegas.',
  },

  game: {
    scanCaption: 'Escanea para escuchar la canción completa',
  },

  hud: {
    cardsLeft: (count: number) => (count === 1 ? 'Queda 1 carta' : `Quedan ${count} cartas`),
  },

  controls: {
    exit: 'Salir de la partida',
    play: 'Reproducir',
    pause: 'Pausar',
    keepDeck: 'Guardar este mazo',
    noPreview: 'Sin fragmento disponible — escanea para escuchar',
  },

  card: {
    yearPending: 'Aún buscando el año…',
    yearUnknown: 'Año desconocido',
    yearUnknownDetail: 'Compruébalo por tu cuenta',
    yearUnconfirmed: 'Año sin confirmar',
  },

  qr: {
    alt: 'Escanea para reproducir en Spotify',
  },

  notice: {
    truncated: (maxTracks: number) =>
      `Puede que una playlist tenga más canciones de las que se muestran — solo se han podido cargar las primeras ${maxTracks}.`,
    skippedTracks: (count: number) =>
      count === 1
        ? 'No se ha podido leer 1 canción y se ha dejado fuera.'
        : `No se han podido leer ${count} canciones y se han dejado fuera.`,
    failedPlaylists: (count: number) =>
      count === 1
        ? 'No se ha podido cargar 1 playlist y se ha dejado fuera.'
        : `No se han podido cargar ${count} playlists y se han dejado fuera.`,
    combinedDeck: (deckSize: number, playlistCount: number) =>
      `${deckSize === 1 ? '1 carta' : `${deckSize} cartas`} de ${playlistCount === 1 ? '1 playlist' : `${playlistCount} playlists`}, ${deckSize === 1 ? 'barajada' : 'barajadas'} en un solo mazo.`,
    yearsUnavailable:
      'Los años no están disponibles en este despliegue, así que las cartas no mostrarán ninguno. El mazo se puede jugar igualmente — escanea una carta para escuchar la canción.',
    dismiss: 'Cerrar aviso',
  },

  end: {
    heading: 'Mazo terminado',
    cardsPlayed: (count: number, playlistName: string) =>
      `${count === 1 ? '1 carta jugada' : `${count} cartas jugadas`} de ${playlistName}`,
    restart: 'Jugar otra vez',
    restartDetail: 'Mismas canciones, nuevo orden',
    home: 'Inicio',
    keepDeckHeading: 'Guardar este mazo',
  },

  deckActions: {
    copyLink: 'Copiar enlace para compartir',
    /** "Same playlist, same shuffle" -- never "the same deck". See the English comment. */
    shareCaption: (playlistCount: number) =>
      `${playlistCount === 1 ? 'Misma playlist' : 'Mismas playlists'}, misma mezcla — los años se vuelven a buscar, así que el mazo puede variar un poco`,
    save: 'Guardar esta playlist',
    saved: 'Guardada en tus playlists',
    print: 'Imprimir como cartas en PDF',
    printing: (completed: number, total: number) => `Creando PDF… ${completed}/${total}`,
    sheetSummary: (sheets: number) =>
      `${sheets === 1 ? '1 hoja A4' : `${sheets} hojas A4`}, ${CARDS_PER_SHEET} cartas por hoja — imprime a doble cara por el borde largo`,
    printWaitsForYears: (pendingCount: number) =>
      `${pendingCount === 1 ? '1 carta sigue' : `${pendingCount} cartas siguen`} buscando su año — la impresión espera a que estén todas`,
    waitingHeading: 'Esperando los últimos años…',
    waitingDetail: (pendingCount: number) =>
      `${pendingCount === 1 ? '1 carta sigue' : `${pendingCount} cartas siguen`} buscando su año.`,
    printPartial: 'Imprimir lo que hay',
    cancel: 'Cancelar',
    exportDone: 'PDF descargado',
    exportDonePartial: (excludedCount: number) =>
      `PDF descargado — ${excludedCount === 1 ? '1 carta excluida' : `${excludedCount} cartas excluidas`}, aún sin año`,
    exportEmpty: 'Ninguna carta tiene año todavía, así que no hay nada que imprimir',
    exportFailed: 'No se ha podido crear el PDF',
    linkCopied: 'Enlace copiado',
    linkCopyFailed: 'No se ha podido copiar automáticamente — aquí tienes el enlace',
    shareLinkFieldLabel: 'Enlace para compartir',
  },

  deckActionsDialog: {
    title: 'Guardar este mazo',
    close: 'Volver a la partida',
  },

  exitDialog: {
    title: '¿Terminar la partida?',
    body: 'Esto termina la partida y te devuelve a la pantalla de inicio.',
    cancel: 'Seguir jugando',
    confirm: 'Terminar partida',
  },

  errorBoundary: {
    heading: 'Algo ha ido mal',
    body: 'El juego ha tenido un problema inesperado y ha tenido que pararse. Recargar suele solucionarlo. Los detalles se han escrito en la consola del navegador.',
    reload: 'Recargar',
    startOver: 'Empezar de cero',
    startOverDetail:
      'Borra primero la partida guardada. Úsalo si recargar sigue fallando — se perderá cualquier partida en curso.',
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
