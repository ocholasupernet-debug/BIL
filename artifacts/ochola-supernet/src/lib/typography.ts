export const FONT_FAMILY_OPTIONS = [
  { value: "DM Sans", label: "DM Sans" },
  { value: "Inter", label: "Inter" },
  { value: "Roboto", label: "Roboto" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Poppins", label: "Poppins" },
  { value: "Nunito", label: "Nunito" },
  { value: "Source Sans 3", label: "Source Sans 3" },
  { value: "Merriweather", label: "Merriweather" },
  { value: "Georgia", label: "Georgia" },
  { value: "Arial", label: "Arial" },
  { value: "Verdana", label: "Verdana" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Courier New", label: "Courier New" },
] as const;

export const FONT_STYLE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "italic", label: "Italic" },
  { value: "oblique", label: "Oblique" },
] as const;

export const FONT_WEIGHT_OPTIONS = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semi-bold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra-bold" },
] as const;

export interface TypographyPreferences {
  fontFamily: string;
  fontStyle: "normal" | "italic" | "oblique";
  fontWeight: number;
  fontSize: number;
}

export const DEFAULT_TYPOGRAPHY: TypographyPreferences = {
  fontFamily: "DM Sans",
  fontStyle: "normal",
  fontWeight: 500,
  fontSize: 18,
};