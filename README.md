# Image upload stuff

Uploading images and producing different artifacts. It turns out the `sharp` library is much easier to use than `ImageMagic`.

Frontend is there only so that I can upload stuff.

## Learnings

- The EventBridge input transformer does not support manipulating strings. You can think of it more as an "extractor" of key/value pairs.

  - Okay, you can concatenate strings, but you cannot split them.

- There are _WebStreams_ and _NodeJs streams_. It seems like the _WebStreams_ is a standard.

  - There are methods in NodeJs to convert from a _WebStream_ into/from a _NodeJs stream_.

- **I find it hard to believe that I can rely on the order of the results in the `Parallel` array, but that seem to be the case**.

  - It is even written in the official spec! You can [read the spec here](https://states-language.net/spec.html#parallel-state).

    The most relevant bit is _"The elements of the output array correspond to the branches in the same order that they appear in the "Branches" array"_.

- When clearing the `type="file"` input, **remember to set the `value` to `""` AFTER you retrieve the `files`**.

  - If you clear the input BEFORE you retrieve the files, the `files` property will be undefined.

    - It is interesting that changing the `value` property has an effect on other properties.

- I'm so lucky :D. I wasted a lot of time making the `next/image` to have a _fade-in_ effect for the `blurHash` URL, but apparently the `next/image` is broken. [See this issue](https://github.com/vercel/next.js/issues/42140#issuecomment-1412181376).

- Getting the actual image from the hash produced by the [`blurhash` library](https://github.com/woltapp/blurhash) is not that straightforward.

  - One has to render a canvas, then put the pixels there, and extract the image data.

    - At a first glance, it should be possible to do this in AWS Lambda. The [`node-canvas`](https://github.com/Automattic/node-canvas#canvastodataurl) library exposes the APIs we need.
