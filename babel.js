import jsx from 'babel-plugin-syntax-jsx'
import murmurHash from './lib/murmurhash2'
import transform from './lib/style-transform'

const STYLE_ATTRIBUTE = 'jsx'
const MARKUP_ATTRIBUTE = 'data-jsx'
const INJECT_METHOD = '_jsxStyleInject'

export default function ({ types: t }) {

  const findStyles = (children) => (
    children.filter((el) => (
      t.isJSXElement(el) &&
      el.openingElement.name.name === 'style' &&
      el.openingElement.attributes.some((attr) => (
        attr.name.name === STYLE_ATTRIBUTE
      ))
    ))
  )

  const getExpressionText = (expr) => (
    t.isTemplateLiteral(expr)
      ? expr.quasis[0].value.raw
      // assume string literal
      : expr.value
  )

  return {
    inherits: jsx,
    visitor: {
      JSXOpeningElement (path, state) {
        if (state.hasJSXStyle) {
          if (null == state.ignoreClosing) {
            // this flag has a two-fold purpose:
            // - ignore the opening tag of the parent element
            //   of the style tag, since we don't want to add
            //   the attribute to that one
            // - keep a counter of elements inside so that we
            //   can keep track of when we exit the parent
            //   to reset state
            state.ignoreClosing = 1
            return
          }

          const el = path.node

          if (el.name && 'style' !== el.name.name) {
            for (const attr of el.attributes) {
              if (attr.name === MARKUP_ATTRIBUTE) {
                // avoid double attributes
                return
              }
            }

            const attr = t.jSXAttribute(
              t.JSXIdentifier(MARKUP_ATTRIBUTE),
              t.JSXExpressionContainer(t.stringLiteral(state.jsxId))
            )
            el.attributes.push(attr)
          }

          state.ignoreClosing++
          // next visit will be: JSXElement exit()
        }
      },
      JSXElement: {
        enter (path, state) {
          if (null == state.hasJSXStyle) {
            const styles = findStyles(path.node.children)
            if (styles.length) {
              state.jsxId = ''
              state.styles = []
              for (const style of styles) {
                if (style.children.length !== 1) {
                  throw path.buildCodeFrameError(`Expected a child under `
                    + `JSX Style tag, but got ${style.children.length} `
                    + `(eg: <style jsx>{\`hi\`}</style>)`)
                }

                const child = style.children[0]

                if (!t.isJSXExpressionContainer(child)) {
                  throw path.buildCodeFrameError(`Expected a child of `
                    + `type JSXExpressionContainer under JSX Style tag `
                    + `(eg: <style jsx>{\`hi\`}</style>), got ${child.type}`)
                }

                const expression = child.expression

                if (!t.isTemplateLiteral(child.expression) &&
                    !t.isStringLiteral(child.expression)) {
                  throw path.buildCodeFrameError(`Expected a template `
                    + `literal or String literal as the child of the `
                    + `JSX Style tag (eg: <style jsx>{\`some css\`}</style>),`
                    + ` but got ${expression.type}`)
                }

                const styleText = getExpressionText(expression)
                const styleId = '' + murmurHash(styleText)
                state.styles.push([
                  styleId,
                  styleText
                ])
              }
              state.jsxId += murmurHash(state.styles.map((s) => s[1]).join(''))
              state.hasJSXStyle = true
              state.file.hasJSXStyle = true
              // next visit will be: JSXOpeningElement
            } else {
              state.hasJSXStyle = false
            }
          } else if (state.hasJSXStyle) {
            const el = path.node.openingElement
            if (el.name && 'style' === el.name.name) {
              // we replace styles with the function call
              const [id, css] = state.styles.shift()
              path.replaceWith(
                t.JSXExpressionContainer(
                  t.callExpression(
                    t.identifier(INJECT_METHOD),
                    [
                      t.stringLiteral(id),
                      t.stringLiteral(transform(id, css))
                    ]
                  )
                )
              )
            }
          }
        },

        exit (path, state) {
          if (state.hasJSXStyle && !--state.ignoreClosing) {
            state.hasJSXStyle = null
          }
        }
      },
      Program: {
        enter (path, state) {
          state.file.hasJSXStyle = false
        },

        exit ({ node, scope }, state) {
          if (!(state.file.hasJSXStyle && !scope.hasBinding(INJECT_METHOD))) {
            return
          }

          const importDeclaration = t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier(INJECT_METHOD))],
            t.stringLiteral('styled-jsx/inject')
          );

          node.body.unshift(importDeclaration);
        }
      },
    }
  }
}
