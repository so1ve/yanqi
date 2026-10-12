import type { GlobalThemeOverrides } from "naive-ui";

export const theme: GlobalThemeOverrides = {
  common: {
    primaryColor: "#277f80",
    primaryColorHover: "#329797",
    primaryColorPressed: "#216a6c",
    primaryColorSuppl: "#277f80",
    infoColor: "#4a6c91",
    successColor: "#398267",
    warningColor: "#b78236",
    errorColor: "#c35c59",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    fontSize: "14px",
    lineHeight: "1.65",
    borderRadius: "6px",
    bodyColor: "#f5f7fa",
    textColorBase: "#243348",
    textColor1: "#243348",
    textColor2: "#526376",
    textColor3: "#798899",
    borderColor: "#e2e8ef",
  },
  Button: { fontWeight: "500" },
  Card: {
    paddingMedium: "24px",
    titleFontSizeMedium: "16px",
    titleFontWeight: "600",
    borderRadius: "8px",
  },
  DataTable: {
    thColor: "#f7f9fb",
    thFontWeight: "500",
    tdColorHover: "#f5f9fa",
    borderColor: "#e9edf2",
  },
  Tabs: { tabFontWeightActive: "600" },
};
