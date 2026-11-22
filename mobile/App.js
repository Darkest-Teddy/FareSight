import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';
import { api, contributeOrigin } from './src/api';
import SignInScreen from './src/SignInScreen';

/**
 * FareSight Contribute.
 *
 * Sign-in is native; everything after it is the Contribute web app in a WebView. The native layer
 * holds the long-lived session token in the keychain and hands the WebView a separate single-use
 * token worth 60 seconds, so the web layer never sees the credential it would need to impersonate
 * the account later.
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [googleClientIds, setGoogleClientIds] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const [failure, setFailure] = useState(null);
  const [loading, setLoading] = useState(true);
  const webview = useRef(null);
  const url = contributeOrigin() + '/';

  // Resume an existing session, and learn whether the server has Google configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [existing, status] = await Promise.all([
        api.me(),
        api.status().catch(() => null),
      ]);
      if (cancelled) return;
      const extra = Constants.expoConfig?.extra ?? {};
      const webClientId = status?.google_client_id ?? undefined;
      setGoogleClientIds({
        // Expo Go and the web build use the server's web client id; a standalone build needs its
        // own per-platform ids, which only exist once the app is actually built for a store.
        clientId: webClientId,
        webClientId,
        iosClientId: extra.googleIosClientId,
        androidClientId: extra.googleAndroidClientId,
      });
      setUser(existing);
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Mint the handoff immediately before the WebView loads, because it expires in 60 seconds.
  useEffect(() => {
    if (!user) { setHandoff(null); return; }
    let cancelled = false;
    api.handoff()
      .then((token) => { if (!cancelled) setHandoff(token ?? ''); })
      // A failed handoff is not fatal: the web app simply loads signed out.
      .catch(() => { if (!cancelled) setHandoff(''); });
    return () => { cancelled = true; };
  }, [user]);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    setHandoff(null);
  }, []);

  const reload = useCallback(() => {
    setFailure(null);
    setLoading(true);
    webview.current?.reload();
  }, []);

  if (checking) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}><ActivityIndicator color="#4fe3ff" /></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar style="light" />
        <SignInScreen onSignedIn={setUser} googleClientIds={googleClientIds} />
      </>
    );
  }

  if (failure) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.title}>Can&apos;t reach the Contribute server</Text>
          <Text style={styles.url}>{url}</Text>
          <Text style={styles.body}>{failure}</Text>
          <Text style={styles.hint}>
            Check that `pnpm dev:contribute` is running and that this phone is on the same network
            as the development machine.
          </Text>
          <Pressable style={styles.button} onPress={reload}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
          <Pressable onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Waiting for the handoff keeps the WebView from loading signed out and then jumping.
  if (handoff === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}><ActivityIndicator color="#4fe3ff" /></View>
      </SafeAreaView>
    );
  }

  /*
   * Runs before the page's own scripts, so the web app finds the token already waiting rather
   * than having to poll for it. JSON.stringify quotes and escapes the value, which keeps a token
   * containing an unexpected character from breaking out of the string.
   */
  const inject = `
    window.__FARESIGHT_HANDOFF__ = ${JSON.stringify(handoff || '')};
    window.__FARESIGHT_NATIVE__ = true;
    true;
  `;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Text style={styles.who} numberOfLines={1}>{user.display_name}</Text>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.signOutSmall}>Sign out</Text>
        </Pressable>
      </View>
      <WebView
        ref={webview}
        source={{ uri: url }}
        injectedJavaScriptBeforeContentLoaded={inject}
        onLoadEnd={() => setLoading(false)}
        onError={({ nativeEvent }) => setFailure(nativeEvent.description ?? 'The page failed to load.')}
        onHttpError={({ nativeEvent }) => setFailure(`The server returned HTTP ${nativeEvent.statusCode}.`)}
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grant"
        originWhitelist={['http://*', 'https://*']}
        style={styles.web}
      />
      {loading ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#4fe3ff" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111112' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  url: { color: '#4fe3ff', fontSize: 13 },
  body: { color: '#ffb2ac', fontSize: 13, textAlign: 'center' },
  hint: { color: '#a8b3cf', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  button: {
    backgroundColor: '#4fe3ff', borderRadius: 999, paddingVertical: 12,
    paddingHorizontal: 28, marginTop: 12,
  },
  buttonText: { color: '#0b1020', fontWeight: '700' },
  signOut: { color: '#a8b3cf', fontSize: 13, marginTop: 16 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#0b1020',
  },
  who: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  signOutSmall: { color: '#4fe3ff', fontSize: 13 },
  web: { flex: 1, backgroundColor: '#111112' },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center',
    justifyContent: 'center', backgroundColor: '#111112',
  },
});
