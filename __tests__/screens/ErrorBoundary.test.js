import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import ErrorBoundary from '../../src/components/ErrorBoundary';

// A render throw used to produce a blank white screen in a release build with
// no way out — for an app whose job is reminding someone to take medicine, a
// silent failure of the whole product.

function Boom({ shouldThrow, label = 'All good' }) {
  if (shouldThrow) throw new Error('render exploded');
  return <Text>{label}</Text>;
}

describe('ErrorBoundary', () => {
  let consoleError;

  beforeEach(() => {
    // React logs the caught error itself; keep the suite output readable.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('catches a render throw instead of blanking the screen', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('reassures the user that their alarms still work', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    // The alarms live in the OS, not in this process — so this is true, and it
    // is the thing a worried user most needs to know.
    expect(screen.getByText(/alarms are safe/i)).toBeTruthy();
  });

  it('shows the underlying message for a bug report', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('render exploded')).toBeTruthy();
  });

  it('logs the failure so a dev session can see it', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled render error',
      expect.any(Error),
      expect.anything()
    );
  });

  it('recovers when Try again is pressed and the cause is gone', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    rerender(
      <ErrorBoundary>
        <Boom shouldThrow={false} label="Recovered" />
      </ErrorBoundary>
    );
    fireEvent.press(screen.getByText('Try again'));

    expect(screen.getByText('Recovered')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('shows the fallback again if the error is still there', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    fireEvent.press(screen.getByText('Try again'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });
});
