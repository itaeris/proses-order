<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'

const props = withDefaults(defineProps<ScrollAreaScrollbarProps & { class?: HTMLAttributes['class'] }>(), {
  orientation: 'vertical',
})

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    :data-orientation="orientation"
    v-bind="delegatedProps"
    :class="cn(
      'flex touch-none bg-muted p-px transition-colors select-none',
      orientation === 'vertical' ? 'h-full w-2.5 border-l border-l-transparent' : 'h-2.5 w-full flex-col border-t border-t-transparent',
      props.class,
    )"
  >
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      :class="cn('relative flex-1 rounded-full bg-foreground/45', orientation === 'vertical' ? 'w-full' : 'h-full')"
    />
  </ScrollAreaScrollbar>
</template>
