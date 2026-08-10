import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Without this, any render-time throw shows a blank white screen in a release
// build with no way out — for an app whose job is to remind someone to take
// medicine, that is a silent failure of the whole product.
//
// Recovery is a remount, not a reload: state is rebuilt from the cloud (or the
// offline cache) on the next render, and the local alarms are unaffected
// because they live in the OS, not in this process.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept deliberately simple: no crash reporter is wired up yet, and a
    // console record is still what a `npx expo start` session will show.
    // eslint-disable-next-line no-console
    console.error('Unhandled render error', error, info?.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Your medicines and alarms are safe — your alarms are set on this phone
          and will still ring. Tap below to return to the app.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.retry}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
        <Text style={styles.detail} numberOfLines={3}>
          {String(error?.message || error)}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#222', marginBottom: 12 },
  body: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  detail: { fontSize: 11, color: '#aaa', marginTop: 28, textAlign: 'center' },
});
