import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getPlans,
  getMyPlan,
  activateTestPlan,
  formatPrice,
  PLAN_MONTHS,
} from '../utils/subscription';
import { Screen, Content, TitleHeader, Card, Button, Segmented } from '../components/ui';
import { colors, radius, shadow } from '../theme';

const METHODS = [
  { id: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm…' },
  { id: 'card', label: 'Debit / credit card', sub: 'Visa, Mastercard, RuPay' },
  { id: 'netbanking', label: 'Net banking', sub: 'All major banks' },
];

function monthsLabel(m) {
  return m === 1 ? '1 month' : `${m} months`;
}

function endDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// What a plan saves against paying monthly for the same guardians.
function savingPct(plan, monthly) {
  if (!monthly || plan.months <= 1) return 0;
  const full = monthly.price_cents * plan.months;
  return Math.round(((full - plan.price_cents) / full) * 100);
}

// The number of guardians a person may link comes from their plan: 1, 2 or 3,
// for 1, 3, 6 or 12 months. Without a plan, none.
//
// Checkout is a TEST flow: it looks like paying, charges nothing, and activates
// the plan straight away (mock_activate_plan). Real payments will replace it.
export default function PlansScreen({ navigation }) {
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState(null);
  const [months, setMonths] = useState(1);
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(null); // plan being bought
  const [method, setMethod] = useState('upi');
  const [stage, setStage] = useState('pay'); // pay | paying | done
  const [paidUntil, setPaidUntil] = useState(null);

  const load = useCallback(async () => {
    const [list, mine] = await Promise.all([getPlans(), getMyPlan()]);
    setPlans(list);
    setCurrent(mine);
    if (mine?.months) setMonths(mine.months);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = (plan) => {
    setCheckout(plan);
    setMethod('upi');
    setStage('pay');
  };

  const pay = async () => {
    setStage('paying');
    // A moment of "processing", as a real checkout would have.
    await new Promise((r) => setTimeout(r, 900));
    const res = await activateTestPlan(checkout.id);
    if (!res.ok) {
      setStage('pay');
      setCheckout(null);
      Alert.alert('Payment failed', res.error || 'Please try again.');
      return;
    }
    setPaidUntil(res.current_period_end || null);
    setStage('done');
    load();
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

  const hasPlan = current && current.months > 0;
  const shown = plans.filter((p) => p.months === months);
  const monthlyFor = (g) => plans.find((p) => p.months === 1 && p.max_guardians === g);

  return (
    <Screen>
      <TitleHeader title="Plans" onClose={() => navigation.goBack()} />
      <Content>
        <Card highlighted={hasPlan}>
          <Text style={styles.currentLabel}>Your plan</Text>
          {hasPlan ? (
            <>
              <Text style={styles.currentName}>{current.name}</Text>
              <Text style={styles.currentSub}>
                Up to {current.max_guardians} guardian{current.max_guardians > 1 ? 's' : ''}
                {current.current_period_end ? ` · active until ${endDate(current.current_period_end)}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.currentName}>No plan</Text>
              <Text style={styles.currentSub}>
                Guardians need a plan. Choose how many guardians and for how long.
              </Text>
            </>
          )}
        </Card>

        <Segmented
          value={months}
          onChange={setMonths}
          options={PLAN_MONTHS.map((m) => ({ value: m, label: monthsLabel(m) }))}
        />

        {shown.map((p) => {
          const isCurrent = current?.id === p.id;
          const perMonth = Math.round(p.price_cents / 100 / p.months);
          const save = savingPct(p, monthlyFor(p.max_guardians));
          return (
            <View key={p.id} style={[styles.plan, isCurrent && styles.planCurrent]}>
              <View style={styles.planHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>
                    {p.max_guardians} guardian{p.max_guardians > 1 ? 's' : ''}
                  </Text>
                  <Text style={styles.planSub}>
                    {monthsLabel(p.months)}
                    {p.months > 1 ? ` · ₹${perMonth}/month` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.price}>{formatPrice(p)}</Text>
                  {save > 0 ? <Text style={styles.save}>Save {save}%</Text> : null}
                </View>
              </View>
              <Button
                title={isCurrent ? 'Current plan' : hasPlan ? 'Switch to this plan' : 'Choose'}
                variant={isCurrent ? 'neutral' : 'primary'}
                disabled={isCurrent}
                onPress={() => open(p)}
              />
            </View>
          );
        })}

        <Text style={styles.note}>
          🧪 Test mode — checkout is simulated and no money is charged. A new plan
          replaces your current one.
        </Text>
      </Content>

      <Modal
        visible={!!checkout}
        transparent
        animationType="slide"
        onRequestClose={() => stage !== 'paying' && setCheckout(null)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => stage === 'pay' && setCheckout(null)}
        >
          <Pressable style={styles.sheet}>
            {checkout && stage === 'done' ? (
              <View style={styles.doneBox}>
                <Text style={styles.doneIcon}>✅</Text>
                <Text style={styles.sheetTitle}>Payment successful</Text>
                <Text style={styles.sheetSub}>
                  {checkout.name} is active
                  {paidUntil ? ` until ${endDate(paidUntil)}` : ''}.
                </Text>
                <Button title="Done" onPress={() => setCheckout(null)} style={{ alignSelf: 'stretch' }} />
              </View>
            ) : checkout ? (
              <>
                <Text style={styles.sheetTitle}>Checkout</Text>
                <View style={styles.summary}>
                  <Text style={styles.summaryName}>{checkout.name}</Text>
                  <Text style={styles.summaryPrice}>{formatPrice(checkout)}</Text>
                </View>
                <Text style={styles.methodLabel}>Pay with</Text>
                {METHODS.map((m) => {
                  const on = method === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.method, on && styles.methodOn]}
                      onPress={() => setMethod(m.id)}
                      disabled={stage === 'paying'}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <View style={[styles.radio, on && styles.radioOn]}>
                        {on ? <View style={styles.radioDot} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.methodName}>{m.label}</Text>
                        <Text style={styles.methodSub}>{m.sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <Button
                  title={stage === 'paying' ? 'Processing…' : `Pay ${formatPrice(checkout)}`}
                  onPress={pay}
                  disabled={stage === 'paying'}
                />
                <Text style={styles.testNote}>Test payment — nothing is charged.</Text>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  currentLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  currentName: { fontSize: 18, fontWeight: '800', color: colors.heading, marginTop: 4 },
  currentSub: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
  plan: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    ...shadow.soft,
  },
  planCurrent: { borderColor: colors.emerald600, borderWidth: 2 },
  planHead: { flexDirection: 'row', alignItems: 'center' },
  planName: { fontSize: 16.5, fontWeight: '800', color: colors.heading },
  planSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  price: { fontSize: 20, fontWeight: '800', color: colors.heading },
  save: { fontSize: 11.5, fontWeight: '800', color: colors.emerald700, marginTop: 2 },
  note: { fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 18, paddingVertical: 8 },

  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.heading },
  sheetSub: { fontSize: 13.5, color: colors.muted, textAlign: 'center' },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.cardSubtle,
    borderRadius: 12,
    padding: 14,
  },
  summaryName: { fontSize: 14.5, fontWeight: '700', color: colors.heading, flex: 1 },
  summaryPrice: { fontSize: 18, fontWeight: '800', color: colors.heading },
  methodLabel: { fontSize: 12, fontWeight: '800', color: colors.muted, marginTop: 4 },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  methodOn: { borderColor: colors.emerald600, backgroundColor: colors.emerald50 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#bbb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.emerald600 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.emerald600 },
  methodName: { fontSize: 14.5, fontWeight: '700', color: colors.heading },
  methodSub: { fontSize: 12, color: colors.muted },
  testNote: { fontSize: 11.5, color: colors.muted, textAlign: 'center' },
  doneBox: { alignItems: 'center', gap: 10 },
  doneIcon: { fontSize: 44 },
});
