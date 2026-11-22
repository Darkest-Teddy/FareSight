import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';

/**
 * The Contribute app is a Vite dev server on port 5180. Expo Go already knows the
 * LAN address it loaded this bundle from, so we reuse that host and swap the port.
 * That way the IP is never hardcoded and keeps working when the machine moves network.
 */
const CONTRIBUTE_PORT = 5180;

function resolveUrl() {
  const override = Constants.expoConfig?.extra?.contributeUrl;
  if (override) return override;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    Constants.manifest2?.extra?.expoGo?.developer?.host;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${CONTRIBUTE_PORT}/`;

  // A production build has no packager host; fall back to the device's own loopback.
  return `http://localhost:${CONTRIBUTE_PORT}/`;
}

export default function App() {
  const url = useMemo(resolveUrl, []);
  const webview = useRef(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);

  const reload = useCallback(() => {
    setFailure(null);
    setLoading(true);
    webview.current?.reload();
  }, []);

  if (failure) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.title}>Can't reach the Contribute server</Text>
          <Text style={styles.url}>{url}</Text>
          <Text style={styles.body}>{failure}</Text>
          <Text style={styles.hint}>
            Check that `pnpm dev:contribute` is running, that this phone is on the same
            Wi-Fi, and that port {CONTRIBUTE_PORT} is allowed through the firewall.
          </Text>
          <TouchableOpacity style={styles.button} onPress={reload}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(url)}>
            <Text style={styles.link}>Open in the phone's browser instead</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <WebView
        ref={webview}
        source={{ uri: url }}
        style={styles.web}
        // The Contribute app draws its own full-bleed layout and handles its own scrolling.
        contentInsetAdjustmentBehavior="never"
        overScrollMode="never"
        bounces={false}
        // `<input type="file" capture="environment">` needs these to reach the camera.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowFileAccess
        allowFileAccessFromFileURLs
        originWhitelist={['*']}
        // Vite's HMR websocket and localStorage both need a stable origin.
        domStorageEnabled
        javaScriptEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        onLoadEnd={() => setLoading(false)}
        onError={({ nativeEvent }) =>
          setFailure(nativeEvent.description ?? 'The WebView could not load the page.')
        }
        onHttpError={({ nativeEvent }) =>
          setFailure(`The server answered ${nativeEvent.statusCode}.`)
        }
      />
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color="#f5f5f5" />
          <Text style={styles.loadingText}>Loading {url}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111112' },
  web: { flex: 1, backgroundColor: '#111112' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  title: { color: '#f5f5f5', fontSize: 19, fontWeight: '600', textAlign: 'center' },
  url: { color: '#9bd1ff', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  body: { color: '#c9c9cf', fontSize: 14, textAlign: 'center' },
  hint: { color: '#85858f', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  button: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
  },
  buttonText: { color: '#111112', fontSize: 15, fontWeight: '600' },
  link: { color: '#9bd1ff', fontSize: 14, marginTop: 4 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111112',
    gap: 12,
  },
  loadingText: { color: '#85858f', fontSize: 13 },
});
