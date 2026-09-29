/**
 * The shared chart layer. Import charts from here, never from the files directly, so the set of
 * chart forms this product ships stays a deliberate, reviewable list rather than whatever each
 * page invented (docs/DESIGN_SYSTEM.md §5.8).
 *
 * Choosing between them is a data-shape question, not a taste one - see the header comment on
 * each component:
 *   TimeSeriesChart  ordered periods       line (direction) · area (magnitude) · column (compare)
 *   RankedBars       named categories      "which is biggest, and is it growing?"
 *   ChartFrame       any bespoke SVG       measurement, states, legend, tooltip, a11y table
 *
 * The older single-purpose visuals (Donut, Gauge, Sparkline) stay where they are: they answer
 * narrower questions and have no axis, so they need none of this frame.
 */

export {
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  ChartSrTable,
  useChartCursor,
  useMeasuredWidth,
  type ChartData,
  type ChartState,
  type LegendItem,
  type TooltipRow,
} from "./ChartFrame";

export {
  TimeSeriesChart,
  type TimeSeries,
  type TimeSeriesDatum,
  type TimeSeriesMode,
  type TimeSeriesBand,
} from "./TimeSeries";

export { RankedBars, type RankedRow } from "./RankedBars";
