/**
 * The Catalan error copy (central Catalan, informal "tu"): every entry of `PLAYLIST_ERROR_MESSAGES`.
 *
 * Typed `ErrorMessages` (`Record<StartFailureCode, string>`), so a new failure code fails the
 * typecheck here too. `offline` and `network` stay different sentences, and `unknown-error`
 * promises nothing -- the same rules as the English map.
 */
import type { ErrorMessages } from './messages';

export const PLAYLIST_ERROR_MESSAGES_CA: ErrorMessages = {
  'invalid-url':
    "Això no sembla l'enllaç d'una playlist de Spotify. Enganxa l'enllaç del menú Comparteix de Spotify.",

  'unsupported-entity':
    "És un enllaç de Spotify, però no d'una playlist — els enllaços d'àlbums, cançons o artistes no funcionen. Obre una playlist i comparteix-la.",

  'not-found-or-private':
    "No s'ha trobat cap playlist pública amb aquest enllaç. Pot ser privada o eliminada, o potser l'enllaç és incorrecte — només es poden jugar playlists públiques.",

  'upstream-unavailable':
    "Ara mateix no es pot connectar amb Spotify. Torna-ho a provar d'aquí a una estona.",

  'unexpected-payload':
    'Spotify ha retornat una cosa que no hem pogut llegir. És un problema nostre, no del teu enllaç.',

  'empty-playlist':
    'Aquesta playlist no té cap cançó que aquesta aplicació pugui reproduir — potser és buida, o cap de les seves cançons està disponible. Prova amb una altra playlist.',

  'no-years-found':
    "No s'ha trobat l'any de publicació de cap cançó d'aquesta playlist, així que no hi havia res per jugar. Normalment vol dir que les cançons són massa desconegudes o massa noves per a la base de dades musical. Prova amb una playlist de cançons més conegudes.",

  offline: 'Sembla que no tens connexió. Torna a connectar-te i prem Comença de nou.',

  network: "No s'ha pogut connectar amb el servidor. Comprova la connexió i torna-ho a provar.",

  'unknown-error': 'Alguna cosa ha fallat en carregar aquesta playlist. Torna-ho a provar.',
};
