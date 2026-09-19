import { useState } from 'react';
import { detectCountry, composePhone, splitPhone, nationalDigits } from './countries';

// A phone number as entered: country (preselected from the phone's own
// settings) plus the national part, joined into E.164 as `phone`.
//
// Someone pasting a full international number into the national field is
// common enough to handle: adopt the country it names rather than treating
// the dial code as part of the subscriber number.
export default function usePhoneNumber() {
  const [country, setCountry] = useState(() => detectCountry());
  const [national, setNational] = useState('');

  const onChangeNational = (text) => {
    if (String(text).trim().startsWith('+')) {
      const split = splitPhone(text);
      if (split) {
        setCountry(split.country);
        setNational(nationalDigits(split.national));
        return;
      }
    }
    setNational(text);
  };

  return {
    country,
    setCountry,
    national,
    onChangeNational,
    phone: composePhone(country, national),
  };
}
