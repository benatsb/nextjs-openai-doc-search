'use client'

import * as React from 'react'
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SSE } from 'sse.js'
import type { CreateCompletionResponse } from 'openai'
import { getEdgeFunctionUrl } from '@/lib/utils'
import { X, Loader, User, Frown, CornerDownLeft, Search, Wand } from 'lucide-react'
import { isNull } from 'util'


enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}
enum MessageStatus {
  Pending = 'pending',
  InProgress = 'in-progress',
  Complete = 'complete',
}
interface Message {
  role: MessageRole
  content: string
  status: MessageStatus
} 

interface NewMessageAction {
  type: 'new'
  message: Message
}

function promptDataReducer(
  state: any[],
  action: {
    index?: number
    answer?: string | undefined
    status?: string
    query?: string | undefined
    type?: 'remove-last-item' | string
  }
) {
  // set a standard state to use later
  let current = [...state]

  if (action.type) {
    switch (action.type) {
      case 'remove-last-item':
        current.pop()
        return [...current]
      default:
        break
    }
  }

  // check that an index is present
  if (action.index === undefined) return [...state]

  if (!current[action.index]) {
    current[action.index] = { query: '', answer: '', status: '' }
  }

  current[action.index].answer = action.answer

  if (action.query) {
    current[action.index].query = action.query
  }
  if (action.status) {
    current[action.index].status = action.status
  }

  return [...current]
}

function messageReducer(state: Message[], messageAction: NewMessageAction) {
  let current = [...state]
  const { type } = messageAction

  switch (type) {
    case 'new': {
      const { message } = messageAction
      current.push(message)
      break
    }
    //case 'update': {
    //  const { index, message } = messageAction
    //  if (current[index]) {
    //    Object.assign(current[index], message)
    //  }
    //  break
    //}
    //case 'append-content': {
    //  const { index, content } = messageAction
    //  if (current[index]) {
    //    current[index].content += content
    //  }
    //  break
    //}
    //case 'reset': {
    //  current = []
    //  break
    //}
    default: {
      throw new Error(`Unknown message action '${type}'`)
    }
  }

  return current
}

export function SearchDialog() {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState<string>('')
  const [question, setQuestion] = React.useState<string>('')
  const [answer, setAnswer] = React.useState<string | undefined>('')
  const edgeFunctionUrl = getEdgeFunctionUrl()
  const eventSourceRef = React.useRef<SSE>()
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)
  const [promptIndex, setPromptIndex] = React.useState(0)
  const [promptData, dispatchPromptData] = React.useReducer(promptDataReducer, [])

  const cantHelp = answer?.trim() === "Sorry, I don't know how to help with that."

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey) {
        setOpen(true)
      }

      if (e.key === 'Escape') {
        console.log('esc')
        handleModalToggle()
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  function handleModalToggle() {
    setOpen(!open)
    setSearch('')
    setQuestion('')
    setAnswer(undefined)
    setPromptIndex(0)
    dispatchPromptData({ type: 'remove-last-item' })
    setHasError(false)
    setIsLoading(false)
  }


  const handleConfirm = React.useCallback(
    async (query: string) => {
      setAnswer(undefined)
      setQuestion(query)
      setSearch('')
      dispatchPromptData({ index: promptIndex, answer: undefined, query })
      setHasError(false)
      setIsLoading(true)


      const messages = promptData.map(({ query, answer, status }) => ({
        role: MessageRole.User,
        content: query,
        status,
      }))

      //const eventSource = new SSE(`${edgeFunctionUrl}/vector-search`, {
      //const eventSource = new SSE(`${edgeFunctionUrl}/clippy-search`, {
      //const eventSource = new SSE(`${edgeFunctionUrl}/ai-docs`, {

      const eventSource = new SSE(`${edgeFunctionUrl}/v2-search`, {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        payload: JSON.stringify({
          messages: messages
          .filter(({ status }) => status === MessageStatus.Complete)
          .map(({ role, content }) => ({ role, content }))
          .concat({ role: MessageRole.User, content: query }),
        }),
      })

      //const eventSource = new SSE(`${edgeFunctionUrl}/v2-search`, {
      //  headers: {
      //    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      //    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      //    'Content-Type': 'application/json',
      //  },
      //  payload: JSON.stringify({ query }),
      //  method: 'POST'
      //})

      function handleError<T>(err: T) {
        setIsLoading(false)
        setHasError(true)
        console.error(err)
      }

      eventSource.addEventListener('error', handleError)
      eventSource.addEventListener('message', (e: any) => {
        try {
          setIsLoading(false)

          if (e.data === '[DONE]') {
            setPromptIndex((x) => {
              return x + 1
            })
            return
          }

          const completionResponse: CreateCompletionResponse = JSON.parse(e.data)
          //const text = completionResponse.choices[0].text
          const text = completionResponse.choices[0].delta.content ?? '';
          console.log(text);
          setAnswer((answer) => {
            const currentAnswer = answer ?? ''

            dispatchPromptData({
              index: promptIndex,
              answer: currentAnswer + text,
            })

            return (answer ?? '') + text
          })
        } catch (err) {
          handleError(err)
        }
      })

      eventSource.stream()

      eventSourceRef.current = eventSource

      setIsLoading(true)
    },
    [promptIndex, promptData]
  )

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    console.log(search)

    handleConfirm(search)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-base text-slate-500 dark:text-slate-400 flex gap-2 items-center z-50 hover:text-slate-700 transition-colors border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-md min-w-[300px] relative"
      >
        <Search width={15} />
        <span className="border border-l h-5"></span>
        <span className="inline-block ml-4">Search...</span>
        <kbd className="absolute right-3 top-2.5 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          <span className="text-xs">⌘</span>K
        </kbd>{' '}
      </button>
      <Dialog open={open}>
        <DialogContent className="sm:max-w-[850px] text-black dark:text-slate-200">
          <DialogHeader>
            <DialogTitle>OpenAI powered doc search</DialogTitle>
            <DialogDescription>
              Build your own ChatGPT style search with Next.js, OpenAI & Supabase.
            </DialogDescription>
            <hr />
            <button className="absolute top-0 right-2 p-2" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              {question && (
                <div className="flex gap-4">
                  <span className="bg-slate-100 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center">
                    <User width={18} className="text-black" />{' '}
                  </span>
                  <p className="mt-0.5 font-semibold">{question}</p>
                </div>
              )}

              {isLoading && (
                <div className="animate-spin relative flex w-5 h-5 ml-2">
                  <Loader />
                </div>
              )}

              {hasError && (
                <div className="flex items-center gap-4">
                  <span className="bg-red-100 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center">
                    <Frown width={18} className="text-white"/>
                  </span>
                  Sad news, the search has failed! Please try again.
                </div>
              )}

              {answer && !hasError ? (
                <div className="flex items-center gap-4">
                  <span className="bg-green-500 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center">
                    <Wand width={18} className="text-black" />
                  </span>
                  <h3 className="font-semibold">Answer:</h3>
                  {answer}
                </div>
              ) : null}

              <div className="relative">
                <Input
                  placeholder="Ask a question..."
                  name="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="col-span-3"
                />
                <CornerDownLeft
                  className={`absolute top-3 right-5 h-4 w-4 text-gray-400 transition-opacity ${
                    search ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
              <div className="text-xs text-gray-500">
                Or try:{' '}
                <button
                  type="button"
                  className="px-1.5 py-0.5 bg-slate-50 hover:bg-slate-100  rounded border border-s-slate-200"
                  onClick={(_) => setSearch('What is the Halo URL?')}
                >
                  What is the Halo URL?
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">Ask</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}