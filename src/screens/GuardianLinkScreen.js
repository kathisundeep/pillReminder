import React from 'react';
import { Screen, Content, TitleHeader } from '../components/ui';
import LinkPersonCard from '../components/LinkPersonCard';

// Linking another person, reached from the 🔗 icon once the guardian already
// looks after someone — so the code form is not in the way on every visit.
export default function GuardianLinkScreen({ navigation }) {
  return (
    <Screen>
      <TitleHeader title="Link a person" onClose={() => navigation.goBack()} />
      <Content>
        <LinkPersonCard onLinked={() => navigation.goBack()} />
      </Content>
    </Screen>
  );
}
