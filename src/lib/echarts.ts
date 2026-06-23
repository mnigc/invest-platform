import * as echarts from 'echarts/core'
import { LineChart, BarChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import {
  TitleComponent, GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, DataZoomComponent, MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, ScatterChart, HeatmapChart,
  TitleComponent, GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, DataZoomComponent, MarkLineComponent,
  CanvasRenderer,
])

export default echarts
