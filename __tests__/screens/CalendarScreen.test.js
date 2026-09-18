import { screen } from '@testing-library/react-native';
import { showScreen, press } from '../../test/renderScreen';
import CalendarScreen from '../../src/screens/CalendarScreen';
import { registerUser, loginUser, addMedicine } from '../../src/utils/storage';

const db = () => globalThis.__db;

async function signIn() {
  await registerUser('alice', 'password123');
  await loginUser('alice', 'password123');
  return db().session.user;
}

// Writes history straight into the fake database for any day, not just today.
function dose(user, medicineId, day, slot, status, at) {
  db().rows('dose_history').push({
    user_id: user.id, medicine_id: medicineId, day, slot, status, at: at || `${day}T12:00:00`,
  });
}

const barColour = (key, band) =>
  [].concat(screen.getByTestId(`bar-${key}-${band}`).props.style)
    .reduce((acc, st) => ({ ...acc, ...st }), {}).backgroundColor;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  // Wednesday 5 Aug 2026, 9 AM.
  jest.setSystemTime(new Date(2026, 7, 5, 9, 0, 0, 0));
});

describe('CalendarScreen', () => {
  async function setup() {
    const user = await signIn();
    const id = await addMedicine(null, {
      name: 'Metformin', times: ['08:00', '20:00'], startDate: '2026-08-01',
    });
    return { user, id };
  }

  it('opens on the month, with a score and a Sunday-first header', async () => {
    const { user, id } = await setup();
    dose(user, id, '2026-08-04', '08:00', 'taken');
    dose(user, id, '2026-08-04', '20:00', 'taken');
    await showScreen(CalendarScreen);

    expect(screen.getAllByText('August 2026').length).toBeGreaterThan(0);
    // Aug 1–3 missed (6 doses), Aug 4 both taken, Aug 5's 8 AM dose past its
    // grace (missed) and 8 PM not yet judged: 2 of 9.
    expect(screen.getByText('22% Monthly Score')).toBeTruthy();
  });

  it('draws a missed morning red and a taken night green on the same day', async () => {
    const { user, id } = await setup();
    dose(user, id, '2026-08-03', '20:00', 'taken');
    await showScreen(CalendarScreen);

    expect(barColour('2026-08-03', 'morning')).toBe('#fee2e2');
    expect(barColour('2026-08-03', 'afternoon')).toBe('#f1f5f9');
    expect(barColour('2026-08-03', 'night')).toBe('#d1fae5');
  });

  it('does not show today`s evening dose as missed in the morning', async () => {
    const { user, id } = await setup();
    dose(user, id, '2026-08-05', '08:00', 'taken', '2026-08-05T08:02:00');
    await showScreen(CalendarScreen);

    expect(barColour('2026-08-05', 'morning')).toBe('#d1fae5');
    expect(barColour('2026-08-05', 'night')).toBe('#ffffff');
  });

  it('shows nothing due before the medicine started', async () => {
    await signIn();
    await addMedicine(null, { name: 'Metformin', times: ['08:00'], startDate: '2026-08-03' });
    await showScreen(CalendarScreen);
    expect(barColour('2026-08-02', 'morning')).toBe('#f1f5f9');
    expect(barColour('2026-08-03', 'morning')).toBe('#fee2e2');
  });

  it('spells out a tapped day dose by dose', async () => {
    const { user, id } = await setup();
    dose(user, id, '2026-08-03', '20:00', 'taken');
    await showScreen(CalendarScreen);

    await press(screen.getByLabelText('3 Aug, 1 missed'));

    expect(screen.getByText('Selected: Aug 3, 2026')).toBeTruthy();
    expect(screen.getByText('1 missed dose')).toBeTruthy();
    expect(screen.getByText('Morning slot (8:00 AM)')).toBeTruthy();
    expect(screen.getByText('Night slot (8:00 PM)')).toBeTruthy();
    expect(screen.getByText('✕ Missed')).toBeTruthy();
    expect(screen.getByText('✓ Taken')).toBeTruthy();
  });
});
