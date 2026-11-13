import { Image, StyleSheet, View } from "react-native";
import appMark from "../assets/monochrome-icon.png";
import { native, useThemedStyles } from "../lib/native";

const MARK = 56;
// The face of the 1024 px monochrome icon: a 480 px circle inside the silhouette, eyes included.
const CROP = { x: 272, y: 303, size: 480 };
const SCALE = MARK / CROP.size;

export function AppMark() {
  const styles = useThemedStyles(createAppMarkStyles);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.circle}
    >
      <Image source={appMark} style={styles.image} />
    </View>
  );
}

function createAppMarkStyles() {
  return StyleSheet.create({
    circle: {
      width: MARK,
      height: MARK,
      borderRadius: MARK / 2,
      overflow: "hidden",
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
    },
    image: {
      width: MARK * 0.8,
      height: MARK * 0.8,
      resizeMode: "contain",
      tintColor: native.label,
    },
  });
}
