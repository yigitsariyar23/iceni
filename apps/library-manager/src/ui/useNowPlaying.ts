// What is playing right now, kept in step with the client.
//
// Spicetify raises "songchange" when the track changes and "onplaypause" when
// it starts or stops. Both only fire on a change, so the current state is read
// once on mount as well -- opening the page mid-song would otherwise show
// nothing until the track ended.

const { useEffect, useState } = Spicetify.React;

export interface NowPlaying {
  uri: string | null;
  paused: boolean;
}

function read(): NowPlaying {
  try {
    const data = Spicetify.Player?.data;
    return { uri: data?.item?.uri ?? null, paused: data?.isPaused !== false };
  } catch {
    return { uri: null, paused: true };
  }
}

export function useNowPlaying(): NowPlaying {
  const [state, setState] = useState<NowPlaying>(read);

  useEffect(() => {
    const update = () => setState(read());
    const player = Spicetify.Player;
    player?.addEventListener?.('songchange', update);
    player?.addEventListener?.('onplaypause', update);
    update();
    return () => {
      player?.removeEventListener?.('songchange', update);
      player?.removeEventListener?.('onplaypause', update);
    };
  }, []);

  return state;
}
