import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPlans, getMyPlan, activatePlanMock } from '../utils/subscription';
import { startCheckout } from '../utils/payments';

function price(p) {
  if (!p.price_cents) return 'Free';
  const amt = (p.price_cents / 100).toLocaleString();
  const sym = p.currency === 'INR' ? '₹' : '$';
  return `${sym}${amt}/${p.interval}`;
}

export default function PlansScreen() {
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setPlans(await getPlans());
    setCurrent(await getMyPlan());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const choose = async (plan) => {
    if (current?.id === plan.id) return;
    setBusyId(plan.id);
    try {
      let charged = false;
      if (plan.price_cents > 0) {
        // Phase 4 stub — falls through to mock activation for now.
        const res = await startCheckout({ planId: plan.id, country: 'IN' });
        charged = res.ok;
      }
      await activatePlanMock(plan.id);
      await load();
      Alert.alert(
        charged ? 'Subscribed' : 'Activated (test mode)',
        charged
          ? `You're now on ${plan.name}.`
          : `${plan.name} is active. Online payment isn't enabled yet — no charge was made.`
      );
    } catch (e) {
      Alert.alert('Could not change plan', String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4CAF50" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.current}>
        Current plan: <Text style={styles.currentName}>{current?.name || 'Free'}</Text>
        {'  '}· up to {current?.max_guardians || 1} guardian
        {(current?.max_guardians || 1) > 1 ? 's' : ''}
      </Text>

      {plans.map((p) => {
        const isCurrent = current?.id === p.id;
        return (
          <View key={p.id} style={[styles.card, isCurrent && styles.cardCurrent]}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.price}>{price(p)}</Text>
            </View>
            <Text style={styles.feat}>
              • Up to {p.max_guardians} guardian{p.max_guardians > 1 ? 's' : ''}
            </Text>
            <Text style={styles.feat}>• Health trackers & report</Text>
            <Text style={styles.feat}>• 2-year medicine history</Text>
            <TouchableOpacity
              style={[
                styles.btn,
                isCurrent ? styles.btnCurrent : styles.btnChoose,
                busyId === p.id && { opacity: 0.6 },
              ]}
              disabled={isCurrent || busyId === p.id}
              onPress={() => choose(p)}
            >
              <Text style={[styles.btnText, isCurrent && styles.btnTextCurrent]}>
                {isCurrent ? 'Current plan' : busyId === p.id ? '…' : p.price_cents ? 'Subscribe' : 'Switch to Free'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <Text style={styles.note}>
        💳 Online payment (UPI / cards) and auto-renew are coming soon. For now
        plans activate in test mode with no charge.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  current: { fontSize: 14, color: '#555', marginBottom: 14 },
  currentName: { fontWeight: '800', color: '#2e7d32' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 1 },
  cardCurrent: { borderWidth: 2, borderColor: '#4CAF50' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 20, fontWeight: '800', color: '#222' },
  price: { fontSize: 16, fontWeight: '700', color: '#4CAF50' },
  feat: { fontSize: 13, color: '#666', marginTop: 6 },
  btn: { marginTop: 14, padding: 12, borderRadius: 8, alignItems: 'center' },
  btnChoose: { backgroundColor: '#4CAF50' },
  btnCurrent: { backgroundColor: '#eee' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnTextCurrent: { color: '#888' },
  note: { fontSize: 12, color: '#999', marginTop: 8, lineHeight: 17 },
});
