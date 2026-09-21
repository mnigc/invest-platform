import * as echarts from 'echarts/core'
import { LineChart, BarChart, ScatterChart } from 'echarts/charts'
import {
  TitleComponent, GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, MarkLineComponent, MarkAreaComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, ScatterChart,
  TitleComponent, GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, MarkLineComponent, MarkAreaComponent,
  CanvasRenderer,
])

export default echarts
