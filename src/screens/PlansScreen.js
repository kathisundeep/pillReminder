import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPlans, getMyPlan, requestPlanChange } from '../utils/subscription';
import { startCheckout } from '../utils/payments';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  Button,
  Pill,
} from '../components/ui';
import { colors } from '../theme';

function price(p) {
  if (!p.price_cents) return 'Free';
  const amt = (p.price_cents / 100).toLocaleString();
  const sym = p.currency === 'INR' ? '₹' : '$';
  return `${sym}${amt}/${p.interval}`;
}

export default function PlansScreen({ navigation }) {
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
      // A paid plan requires a completed payment. Checkout is still a stub, so
      // it always reports failure — and we must stop there. Activating anyway
      // was how a user could hand themselves the top tier for free.
      if (plan.price_cents > 0) {
        const res = await startCheckout({ planId: plan.id, country: 'IN' });
        if (!res.ok) {
          Alert.alert(
            'Payment not available yet',
            res.message ||
              `${plan.name} needs a payment before it can be activated. Online payment is not enabled yet.`
          );
          return;
        }
      }

      // Free is a downgrade, not a grant, but it still goes through the server
      // so any recurring mandate is cancelled with it.
      const res = await requestPlanChange(plan.id);
      if (!res.ok) {
        Alert.alert('Could not change plan', res.error);
        return;
      }
      await load();
      Alert.alert('Plan updated', `You're now on ${plan.name}.`);
    } catch (e) {
      Alert.alert('Could not change plan', String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TitleHeader title="Plans & subscription" onClose={() => navigation.goBack()} />
      <Content>
        <View style={styles.currentRow}>
          <Text style={styles.currentLabel}>Current plan</Text>
          <Pill bg={colors.emerald50} color={colors.emerald700}>
            {current?.name || 'Free'} · up to {current?.max_guardians || 1} guardian
            {(current?.max_guardians || 1) > 1 ? 's' : ''}
          </Pill>
        </View>

        {plans.map((p) => {
          const isCurrent = current?.id === p.id;
          return (
            <Card key={p.id} highlighted={isCurrent}>
              <View style={styles.cardHead}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.price}>{price(p)}</Text>
              </View>
              <Text style={styles.feat}>
                • Up to {p.max_guardians} guardian{p.max_guardians > 1 ? 's' : ''}
              </Text>
              <Text style={styles.feat}>• Health trackers &amp; report</Text>
              <Text style={styles.feat}>• 2-year medicine history</Text>
              <Button
                style={styles.cta}
                title={
                  isCurrent
                    ? 'Current plan'
                    : busyId === p.id
                    ? '…'
                    : p.price_cents
                    ? 'Subscribe'
                    : 'Switch to Free'
                }
                variant={isCurrent ? 'neutral' : 'primary'}
                disabled={isCurrent || busyId === p.id}
                onPress={() => choose(p)}
              />
            </Card>
          );
        })}

        <Text style={styles.note}>
          💳 Online payment (UPI / cards) and auto-renew are coming soon. Paid
          plans cannot be activated until then.
        </Text>
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  currentRow: { gap: 8 },
  currentLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  name: { fontSize: 20, fontWeight: '800', color: colors.heading },
  price: { fontSize: 16, fontWeight: '800', color: colors.emerald600 },
  feat: { fontSize: 13, color: colors.body, marginTop: 6 },
  cta: { marginTop: 16 },
  note: { fontSize: 12, color: colors.muted, lineHeight: 18 },
});
