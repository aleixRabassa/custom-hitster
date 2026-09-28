/**
 * The Spanish (Spain, informal "tú") error copy for every playlist failure.
 *
 * Typed `ErrorMessages`, so a new `StartFailureCode` fails the typecheck here too. `offline` and
 * `network` stay different sentences, and `unknown-error` promises nothing -- as in English.
 */
import type { ErrorMessages } from './messages';

export const PLAYLIST_ERROR_MESSAGES_ES: ErrorMessages = {
  'invalid-url':
    'Eso no parece un enlace a una playlist de Spotify. Pega el enlace del menú Compartir de Spotify.',

  'unsupported-entity':
    'Es un enlace de Spotify, pero no a una playlist — los enlaces a álbumes, canciones o artistas no sirven. Abre una playlist y comparte esa.',

  'not-found-or-private':
    'No se ha encontrado ninguna playlist pública con ese enlace. Puede que sea privada, que se haya eliminado o que el enlace esté mal — solo se pueden jugar playlists públicas.',

  'upstream-unavailable':
    'Ahora mismo no se puede conectar con Spotify. Vuelve a intentarlo en un momento.',

  'unexpected-payload':
    'Spotify ha devuelto algo que no hemos podido leer. Es un problema nuestro, no de tu enlace.',

  'empty-playlist':
    'Esa playlist no tiene canciones que esta app pueda reproducir — puede que esté vacía o que ninguna de sus canciones esté disponible. Prueba con otra playlist.',

  'no-years-found':
    'No se ha encontrado el año de lanzamiento de ninguna canción de esa playlist, así que no había nada que jugar. Suele pasar cuando las canciones son demasiado desconocidas o demasiado nuevas para la base de datos musical. Prueba con una playlist de temas más conocidos.',

  offline: 'Parece que no tienes conexión. Vuelve a conectarte y pulsa Empezar otra vez.',

  network: 'No se ha podido conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.',

  'unknown-error': 'Algo ha ido mal al cargar esa playlist. Vuelve a intentarlo.',
};
