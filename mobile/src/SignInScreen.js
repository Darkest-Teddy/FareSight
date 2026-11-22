import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import Constants from 'expo-constants';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { api } from './api';

// Lets the browser tab that handled the Google redirect close itself and hand control back.
WebBrowser.maybeCompleteAuthSession();

/**
 * Native sign-in.
 *
 * These are real React Native screens, not a web form inside the WebView. A WebView can be
 * navigated, and a password typed into one is harder to trust; keeping credentials native also
 * lets the session token live in the platform keychain where the web layer cannot read it.
 */
export default function SignInScreen({ onSignedIn, googleClientIds }) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /*
   * Every id the app actually supplies counts, not just the per-platform ones.
   *
   * App.js passes `clientId` and `webClientId` from the server's GOOGLE_CLIENT_ID, and leaves
   * `iosClientId` and `androidClientId` null until a standalone build defines them in app.json.
   * Checking only the per-platform ids therefore hid the Google button in exactly the common
   * case: Google configured on the server, running in Expo Go.
   */
  const configured = Boolean(
    googleClientIds?.clientId || googleClientIds?.webClientId
    || googleClientIds?.expoClientId || googleClientIds?.iosClientId || googleClientIds?.androidClientId,
  );

  // The hook must be called unconditionally, so it is given empty ids when Google is unconfigured
  // and the button is simply not rendered.
  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest(
    googleClientIds ?? {},
  );

  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      if (googleResponse?.type === 'error') setError('Google sign-in failed.');
      return;
    }
    const idToken = googleResponse.params?.id_token ?? googleResponse.authentication?.idToken;
    if (!idToken) {
      setError('Google did not return an identity token.');
      return;
    }
    let cancelled = false;
    setBusy(true);
    api.google(idToken)
      .then((user) => { if (!cancelled) onSignedIn(user); })
      .catch((failure) => { if (!cancelled) setError(failure.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [googleResponse, onSignedIn]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = registering
        ? await api.register(email.trim(), password, displayName.trim() || undefined)
        : await api.login(email.trim(), password);
      setPassword('');
      onSignedIn(user);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }, [busy, registering, email, password, displayName, onSignedIn]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>FareSight</Text>
        <Text style={styles.title}>{registering ? 'Create an account' : 'Sign in'}</Text>
        <Text style={styles.subtitle}>
          You only need an account to add places. Browsing FareSight needs none.
        </Text>

        {configured ? (
          <>
            <Pressable
              style={({ pressed }) => [styles.google, pressed && styles.pressed]}
              disabled={!googleRequest || busy}
              onPress={() => { setError(null); promptGoogle(); }}
            >
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
            <View style={styles.divider}>
              <View style={styles.rule} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.rule} />
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#6b7694"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!busy}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="At least 12 characters"
          placeholderTextColor="#6b7694"
          secureTextEntry
          autoCapitalize="none"
          textContentType={registering ? 'newPassword' : 'password'}
          editable={!busy}
          onSubmitEditing={submit}
        />

        {registering ? (
          <>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Shown next to places you add"
              placeholderTextColor="#6b7694"
              autoCapitalize="words"
              editable={!busy}
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.submit, (pressed || busy) && styles.pressed]}
          onPress={submit}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#0b1020" />
            : <Text style={styles.submitText}>{registering ? 'Create account' : 'Sign in'}</Text>}
        </Pressable>

        <Pressable onPress={() => { setRegistering(!registering); setError(null); }} disabled={busy}>
          <Text style={styles.switch}>
            {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>

        <Text style={styles.host}>
          {Constants.expoConfig?.extra?.apiUrl ?? 'Using the development server on this network'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1020' },
  content: { padding: 24, paddingTop: 72, gap: 4 },
  brand: { color: '#4fe3ff', fontSize: 13, fontWeight: '700', letterSpacing: 2, marginBottom: 20 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#a8b3cf', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 22 },
  google: {
    backgroundColor: '#1a2340', borderColor: '#384561', borderWidth: 1, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  googleText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  rule: { flex: 1, height: 1, backgroundColor: '#2c3752' },
  dividerText: { color: '#6b7694', fontSize: 12 },
  label: { color: '#a8b3cf', fontSize: 12, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#141b33', borderColor: '#384561', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15,
  },
  error: { color: '#ffb2ac', fontSize: 13, marginTop: 14, lineHeight: 18 },
  submit: {
    backgroundColor: '#4fe3ff', borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', marginTop: 24,
  },
  submitText: { color: '#0b1020', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  switch: { color: '#4fe3ff', fontSize: 14, textAlign: 'center', marginTop: 18 },
  host: { color: '#49536e', fontSize: 11, textAlign: 'center', marginTop: 28 },
});
