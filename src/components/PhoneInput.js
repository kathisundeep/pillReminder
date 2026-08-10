import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  Pressable,
  TextInput,
} from 'react-native';
import { Input } from './ui';
import { COUNTRIES } from '../utils/countries';
import { colors, radius, type } from '../theme';

// A dial-code selector joined to a national-number field.
//
// The two are one control on purpose: a phone number is only meaningful with
// its country, and splitting them into separate fields invites the number to be
// submitted against whichever country happened to be left selected.

function CountryRow({ item, selected, accent, onPress }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.name} ${item.dial}`}
    >
      <Text style={styles.rowFlag}>{item.flag}</Text>
      <Text style={styles.rowName} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.rowDial}>{item.dial}</Text>
      {selected ? <Text style={[styles.tick, { color: accent }]}>✓</Text> : null}
    </Pressable>
  );
}

export default function PhoneInput({
  country,
  onChangeCountry,
  value,
  onChangeText,
  onSubmitEditing,
  role = 'patient',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const accent = role === 'guardian' ? colors.teal600 : colors.emerald600;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    // Digits mean they are typing a dial code, not a name.
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        (digits && c.dial.includes(digits))
    );
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (c) => {
    onChangeCountry(c);
    close();
  };

  return (
    <>
      <View style={styles.field}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.dial, pressed && styles.dialPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Country code, currently ${country.name} ${country.dial}`}
        >
          <Text style={styles.dialFlag}>{country.flag}</Text>
          <Text style={styles.dialText}>{country.dial}</Text>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>

        <Input
          style={styles.number}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoCorrect={false}
          textContentType="telephoneNumber"
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          returnKeyType="next"
          accessibilityLabel="Phone number"
        />
      </View>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={close}
        transparent={false}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Select country</Text>
            <Pressable
              onPress={close}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.search}
            placeholder="Search country or code"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search country"
          />

          {results.length === 0 ? (
            <Text style={styles.noResults}>No country matches “{query}”.</Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              renderItem={({ item }) => (
                <CountryRow
                  item={item}
                  selected={item.code === country.code}
                  accent={accent}
                  onPress={choose}
                />
              )}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', gap: 8 },
  dial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
  },
  dialPressed: { backgroundColor: colors.canvas },
  dialFlag: { fontSize: 18 },
  dialText: { fontSize: 15, fontWeight: '700', color: colors.heading },
  chevron: { fontSize: 11, color: colors.muted },
  number: { flex: 1 },

  sheet: { flex: 1, backgroundColor: colors.surface, paddingTop: 52 },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.heading },
  close: { fontSize: 18, color: colors.muted, fontWeight: '700' },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    fontSize: 15,
    color: colors.heading,
    backgroundColor: colors.canvas,
  },
  noResults: {
    padding: 24,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: colors.canvas },
  rowPressed: { opacity: 0.6 },
  rowFlag: { fontSize: 22 },
  rowName: { flex: 1, fontSize: 15, color: colors.heading },
  rowDial: { ...type.label, color: colors.muted, fontWeight: '700' },
  tick: { fontSize: 15, fontWeight: '800' },
});
