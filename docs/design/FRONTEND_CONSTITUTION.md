# WaveX Frontend Constitution

This document defines the frontend philosophy for WaveX.

It is not a style guide.

It is the constitution that governs every UI decision.

Violation of these principles is considered a bug.

---

# Product Philosophy

WaveX is not a dashboard.

WaveX is an operating system for organizations.

The interface should feel like entering rooms inside a living organization rather than navigating software.

Conversation is always the primary interface.

The canvas exists to visualize organizational state.

Never build traditional SaaS dashboards.

Never expose unnecessary controls.

Every screen should feel calm, intelligent and inevitable.

---

# Design References

Primary references

• Claude Desktop
• Apple Human Interface
• Linear
• Stripe Dashboard
• Arc Browser
• Notion

Do NOT imitate

• Material Design
• Windows Fluent
• Crypto dashboards
• Dribbble concepts
• Generic AI interfaces
• Heavy glassmorphism

---

# Information Architecture

Every persistent view is one of the following.

Organization

Department

Project

Deliverable

Agent

Task

Nothing else.

Every persistent view shares the same architecture.

Identity

↓

Current Work

↓

People

↓

Memory

↓

Artifacts

Never invent additional page structures.

---

# Workspace Philosophy

The conversation never changes.

The workspace changes.

The right side of the application is generated around the user's current context.

The workspace is always contextual.

Do not create fixed dashboards.

Do not create tab-heavy interfaces.

The workspace should unfold naturally from the conversation.

---

# Layout

Split view.

Left

Conversation

Persistent

35%

Right

Workspace

Persistent

65%

The workspace contains exactly one dominant object.

Never split attention across multiple primary objects.

---

# Navigation

Navigation is zoom.

Never page changes.

Never context switches.

Users descend through the organization.

Organization

↓

Department

↓

Project

↓

Deliverable

↓

Agent

↓

Task

The transition should feel like walking deeper into the same place.

---

# Progressive Disclosure

Information is earned.

Overview

Minimal.

Department

More context.

Project

Execution.

Task

Complete detail.

Never expose every piece of information immediately.

---

# Visual Hierarchy

Whitespace is preferred over decoration.

Typography creates hierarchy.

Not color.

Not borders.

Not icons.

Every pixel must justify its existence.

---

# Materials

Use architectural materials.

Not decorative materials.

Large white surfaces.

Hairline borders.

Extremely subtle shadows.

Very soft translucency.

Glass only communicates hierarchy.

Never decoration.

---

# Motion

Motion explains relationships.

Nothing simply appears.

Everything comes from somewhere.

Nothing disappears.

Everything returns somewhere.

Animations are between 120–180 ms.

No bounce.

No playful easing.

Everything should feel expensive.

---

# Shadows

Only four elevations exist.

Surface

Workspace

Overlay

Popover

No custom shadow values.

No arbitrary elevation.

---

# Colors

The interface is almost monochrome.

Background

Warm white.

Primary text

Near black.

Secondary text

Muted gray.

Accent colors only communicate state.

Healthy

Muted green.

Attention

Amber.

Critical

Red.

Never use color for navigation.

---

# Components

Buttons

Quiet.

Rounded.

Hairline borders.

Cards

Large radius.

Minimal elevation.

No decorative gradients.

Capability chips

Lightweight command suggestions.

Not pills.

Not badges.

---

# Flywheel

The flywheel is not a chart.

It is a precision organizational instrument.

Think

Luxury watch.

Mission control.

Apple hardware.

Never pie chart.

Never donut chart.

Use

Hairline geometry.

Perfect spacing.

Floating labels.

Subtle breathing.

Tiny activity pulses.

Massive whitespace.

The flywheel should feel engineered.

Not illustrated.

---

# Generated Workspaces

The AI builds workspaces.

Never templates.

Example

Question

↓

Workspace appears

↓

Evidence arrives

↓

Reasoning streams

↓

Artifacts generated

↓

Workspace settles

The workspace should visibly assemble itself.

---

# Empty States

Nothing should feel empty.

Idle organizations breathe.

Subtle motion.

Tiny activity indicators.

Recent work.

Current objective.

The interface should always feel alive.

WaveX amendment (approved): "alive" never means fabricated — nominal
health is silence, zero counts are absent, and nothing renders activity
that is not actually happening.

---

# Microinteractions

Hover

2px lift.

Selection

Physical commit.

Streaming

Natural expansion.

Completion

Quiet resolution.

Everything should feel tactile.

Nothing should be flashy.

---

# Performance

Never block.

Prefer streaming.

Prefer optimistic rendering.

Prefer skeletons.

Avoid spinners.

---

# Decision Filter

Before adding any UI element ask:

Does this improve understanding?

If no,

delete it.

Does this reduce cognitive load?

If no,

delete it.

Does this communicate organizational state?

If no,

delete it.

Less UI is always preferred.

---

# Final Rule

WaveX should never feel like software.

It should feel like entering a living organization.
