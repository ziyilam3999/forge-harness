# Design Rules

Quality constraints injected into the design-prototype agent prompt.
These rules ensure generated prototypes meet baseline design standards.

## Layout Rules

- Use semantic HTML structure (headings hierarchy, landmarks)
- Layout follows the questionnaire's selected structure
- Content areas must have clear visual boundaries
- Navigation placement must be consistent across pages

## Color Rules

- Ensure WCAG AA minimum color contrast (4.5:1 for body text, 3:1 for large text)
- Use the design token palette as the primary color source
- Avoid pure black (#000) on pure white (#fff) for body text; prefer softer contrast pairs
- Limit the active palette to 3-5 colors plus neutrals

## Typography Rules

- Clear visual distinction between heading levels (h1 > h2 > body in both size and weight)
- Body text at minimum 1rem for readability
- Line height between 1.4 and 1.6 for body copy
- Limit to 2 font families maximum (one for headings, one for body)

## Spacing Rules

- Consistent spacing using the design token's base unit
- Padding and margins should be multiples of the base spacing value
- Vertical rhythm maintained through consistent spacing between sections
- Adequate whitespace around interactive elements for touch targets

## Component Rules

- Cards: consistent border-radius, padding, and shadow across all card instances
- Tables: alternating row backgrounds for readability, sticky headers on scroll
- Navigation: clear active-state indication, keyboard-accessible focus styles
