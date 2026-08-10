import { render, screen, fireEvent, act } from '@testing-library/react-native';
import DaysSelector from '../../src/components/DaysSelector';
import WheelTimePicker from '../../src/components/WheelTimePicker';

describe('DaysSelector', () => {
  it('renders the week starting on Sunday', () => {
    render(<DaysSelector value={[]} onChange={jest.fn()} />);
    expect(
      ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].every((d) => screen.getByText(d))
    ).toBe(true);
  });

  it('selects a day by its 0-based index', () => {
    const onChange = jest.fn();
    render(<DaysSelector value={[]} onChange={onChange} />);

    fireEvent.press(screen.getByText('Su'));
    expect(onChange).toHaveBeenCalledWith([0]);

    onChange.mockClear();
    fireEvent.press(screen.getByText('Sa'));
    expect(onChange).toHaveBeenCalledWith([6]);
  });

  it('deselects a day that is already chosen', () => {
    const onChange = jest.fn();
    render(<DaysSelector value={[1, 3]} onChange={onChange} />);
    fireEvent.press(screen.getByText('Mo'));
    expect(onChange).toHaveBeenCalledWith([3]);
  });

  it('keeps the selection sorted as days are added out of order', () => {
    const onChange = jest.fn();
    const { rerender } = render(<DaysSelector value={[5]} onChange={onChange} />);
    fireEvent.press(screen.getByText('Tu'));
    expect(onChange).toHaveBeenCalledWith([2, 5]);

    onChange.mockClear();
    rerender(<DaysSelector value={[2, 5]} onChange={onChange} />);
    fireEvent.press(screen.getByText('Su'));
    expect(onChange).toHaveBeenCalledWith([0, 2, 5]);
  });

  it('tolerates a missing value prop', () => {
    const onChange = jest.fn();
    render(<DaysSelector onChange={onChange} />);
    fireEvent.press(screen.getByText('We'));
    expect(onChange).toHaveBeenCalledWith([3]);
  });
});

describe('WheelTimePicker', () => {
  const setup = (props = {}) => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <WheelTimePicker
        visible
        initialHour={8}
        initialMinute={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    );
    return { onConfirm, onCancel };
  };

  it('renders nothing when not visible', () => {
    render(<WheelTimePicker visible={false} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByText('Pick time')).toBeNull();
  });

  it('shows the sheet when visible', () => {
    setup();
    expect(screen.getByText('Pick time')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('cancels without confirming', () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.press(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms the initial time unchanged', () => {
    const { onConfirm } = setup({ initialHour: 8, initialMinute: 30 });
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 8, minute: 30 });
  });

  // 12-hour wheel -> 24-hour value. The midnight/noon boundaries are where
  // hand-rolled AM/PM conversions usually break.
  it.each([
    [0, 0, '12:00 AM -> 0'],
    [12, 12, '12:00 PM -> 12'],
    [1, 1, '1 AM -> 1'],
    [11, 11, '11 AM -> 11'],
    [13, 13, '1 PM -> 13'],
    [23, 23, '11 PM -> 23'],
  ])('round-trips hour %i (%s)', (initialHour, expected) => {
    const { onConfirm } = setup({ initialHour, initialMinute: 15 });
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: expected, minute: 15 });
  });

  it('lists 12 hours, 60 minutes and both meridiems', () => {
    setup();
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByText('PM')).toBeTruthy();
    expect(screen.getByText('59')).toBeTruthy(); // minutes go to 59
    expect(screen.getByText('00')).toBeTruthy(); // zero-padded
  });

  it('converts a scrolled 12 AM selection to hour 0', () => {
    const { onConfirm } = setup({ initialHour: 9, initialMinute: 0 });

    const scrolls = screen.UNSAFE_getAllByType(require('react-native').ScrollView);
    // Columns are [hour, minute, meridiem]; select hour index 11 (=12) and AM.
    act(() => {
      scrolls[0].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 11 * 44 } },
      });
      scrolls[2].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 0 } },
      });
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 0, minute: 0 });
  });

  it('converts a scrolled 12 PM selection to hour 12', () => {
    const { onConfirm } = setup({ initialHour: 9, initialMinute: 0 });
    const scrolls = screen.UNSAFE_getAllByType(require('react-native').ScrollView);

    act(() => {
      scrolls[0].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 11 * 44 } },
      });
      scrolls[2].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 44 } }, // PM
      });
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 12, minute: 0 });
  });

  it('picks up a scrolled minute', () => {
    const { onConfirm } = setup({ initialHour: 8, initialMinute: 0 });
    const scrolls = screen.UNSAFE_getAllByType(require('react-native').ScrollView);

    act(() => {
      scrolls[1].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 45 * 44 } },
      });
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 8, minute: 45 });
  });

  it('clamps a scroll past the end of a column', () => {
    const { onConfirm } = setup({ initialHour: 8, initialMinute: 0 });
    const scrolls = screen.UNSAFE_getAllByType(require('react-native').ScrollView);

    act(() => {
      scrolls[1].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: 9999 } },
      });
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 8, minute: 59 });
  });

  it('clamps a negative (over-scroll) offset to the first item', () => {
    const { onConfirm } = setup({ initialHour: 8, initialMinute: 30 });
    const scrolls = screen.UNSAFE_getAllByType(require('react-native').ScrollView);

    act(() => {
      scrolls[1].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { y: -200 } },
      });
    });

    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith({ hour: 8, minute: 0 });
  });
});
